import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:tls";
import { chromium } from "playwright";
import { recordWalkthrough } from "../../scripts/console/record-walkthrough.ts";
import { prepareQaConsoleTheme } from "./qa-installation.mjs";
import { waitFor } from "./qa-utils.mjs";
import { submitChatTurnWithAssistantProof, waitForStockUi } from "./native-ui-chat.mjs";
import { renderPresetTemplate } from "../../packages/contracts/src/index.ts";
import { protectedText } from "./qa-secrets.mjs";

export async function createQaBrowser(f, { themed, artifactsDirectory }) {
  if (themed) {
    await prepareQaConsoleTheme(f);
  }
  const nativeHost = `native.${f.cluster}.oce.localhost`;
  let nativeOrigin;
  const ca = f.browserCA ?? join(f.directory, "browser-ca.crt");
  let relay;
  let upstream;
  const sockets = new Set();
  if (f.controlPlane === "compose") {
    const key = join(f.directory, "browser-tls.key");
    await f.run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      ca,
      "-days",
      "2",
      "-subj",
      `/CN=${nativeHost}`,
      "-addext",
      `subjectAltName=DNS:${nativeHost}`,
      "-addext",
      "basicConstraints=critical,CA:TRUE",
    ]);
    relay = createServer(
      { key: await readFile(key), cert: await readFile(ca), minVersion: "TLSv1.2" },
      (socket) => {
        if (!upstream) {
          socket.destroy();
          return;
        }
        const target = connect(upstream.port, "127.0.0.1");
        for (const connection of [socket, target]) {
          sockets.add(connection);
          connection.once("close", () => sockets.delete(connection));
        }
        socket.pipe(target);
        target.pipe(socket);
        socket.on("error", () => target.destroy());
        target.on("error", () => socket.destroy());
      },
    );
    await new Promise((accept, reject) => {
      relay.once("error", reject);
      // Port 0: the relay's port is read once bound, so nothing else can take it first.
      relay.listen(0, "127.0.0.1", accept);
    });
    nativeOrigin = `https://${nativeHost}:${relay.address().port}`;
    f.resources.after(async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((accept) => relay.close(accept));
    });
  }
  // Add/remove only this run's CA nickname. Neither global certificate bypasses
  // nor Playwright ignoreHTTPSErrors are acceptable proof of trusted TLS.
  const database = join(homedir(), ".pki", "nssdb");
  await mkdir(database, { recursive: true, mode: 0o700 });
  try {
    await stat(join(database, "cert9.db"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await f.run("certutil", ["-N", "--empty-password", "-d", `sql:${database}`]);
  }
  const nickname = `oce-qa-${f.suffix}`;
  await f.run("certutil", ["-A", "-d", `sql:${database}`, "-n", nickname, "-t", "C,,", "-i", ca]);
  f.resources.after(() => f.run("certutil", ["-D", "-d", `sql:${database}`, "-n", nickname]));
  const browser = await chromium.launchPersistentContext(join(f.directory, "browser-profile"), {
    headless: true,
    ...(process.env.OCC_TEST_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OCC_TEST_BROWSER_EXECUTABLE }
      : {}),
    args: [`--host-resolver-rules=MAP *.${f.cluster}.oce.localhost 127.0.0.1`],
    ignoreHTTPSErrors: false,
  });
  f.resources.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(f.consoleUrl + "/console/");
  if (themed) {
    assert.equal(await page.title(), "Example Agents");
  }
  await page.getByLabel("Email", { exact: true }).fill(f.credentials.email);
  await page.getByLabel("Password").fill(f.credentials.password);
  const signedIn = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/sign-in/email" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal((await signedIn).status(), 200, "console sign-in must succeed");
  // An authenticated API read disambiguates a still-visible login page.
  const authenticated = await page.evaluate(async () => (await fetch("/installation")).status);
  assert.equal(authenticated, 200);
  await f.record("console", {
    authenticated: true,
    origin: f.consoleUrl,
    tls: f.controlPlane === "kubernetes",
  });
  return {
    nativeOrigin: f.controlPlane === "compose" ? nativeOrigin : undefined,
    async verifyAgentAuthor(presetName, nameSuffix, verify) {
      const nameLabel = nameSuffix.replace(/^-/, "");
      const email = `qa-agent-author-${randomUUID()}@example.test`;
      const password = `qa-agent-author-${randomUUID()}-Password`;
      const account = await page.evaluate(
        async ({ email, password }) => {
          const response = await fetch("/api/auth/accounts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password, name: "QA Agent Author" }),
          });
          return { status: response.status, body: await response.json() };
        },
        { email, password },
      );
      assert.equal(account.status, 201, "Installation administrator must create the test account");
      const principalId = account.body.data.principalId;
      assert.equal(typeof principalId, "string");

      const authorContext = await browser.browser().newContext();
      const authorPage = await authorContext.newPage();
      try {
        await authorPage.goto(`${f.consoleUrl}/console/`);
        await authorPage.getByLabel("Email", { exact: true }).fill(email);
        await authorPage.getByLabel("Password").fill(password);
        const signedIn = authorPage.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/auth/sign-in/email" &&
            response.request().method() === "POST",
        );
        await authorPage.getByRole("button", { name: "Sign in", exact: true }).click();
        assert.equal((await signedIn).status(), 200, "test user sign-in must succeed");

        const request = async (method, path, body, expectedStatus = 200) => {
          const result = await authorPage.evaluate(
            async ({ method, path, body }) => {
              const response = await fetch(path, {
                method,
                headers: body === undefined ? {} : { "content-type": "application/json" },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              });
              const text = await response.text();
              return { status: response.status, body: text ? JSON.parse(text) : undefined };
            },
            { method, path, body },
          );
          assert.equal(
            result.status,
            expectedStatus,
            `${method} ${path} must return ${expectedStatus}`,
          );
          return result.body?.data;
        };

        assert.deepEqual(await request("GET", "/namespaces"), []);
        const deniedConfiguration = await f.api(
          "POST",
          `/namespaces/${f.namespace.id}/configurations`,
          { kind: "agent", values: {} },
        );
        const deniedBindingsBefore = await f.api(
          "GET",
          `/namespaces/${f.namespace.id}/iam/access-bindings`,
        );
        await request(
          "POST",
          `/namespaces/${f.namespace.id}/agents`,
          {
            name: `qa-unassigned-${nameLabel}`,
            configurationId: deniedConfiguration.id,
            executionMode: "embedded",
            harnessAuth: {
              method: "api_key",
              source: {
                kind: "secret",
                namespaceId: f.namespace.id,
                id: `sec_${randomUUID()}`,
              },
            },
          },
          403,
        );
        assert.deepEqual(
          await f.api("GET", `/namespaces/${f.namespace.id}/iam/access-bindings`),
          deniedBindingsBefore,
          "an unassigned create denial must not create credential grants",
        );
        const authorRole = await f.api("POST", `/namespaces/${f.namespace.id}/iam/roles`, {
          preset: "agent-author",
        });
        const binding = await f.api("POST", `/namespaces/${f.namespace.id}/iam/access-bindings`, {
          subjectKind: "identity",
          subjectId: principalId,
          roleId: authorRole.id,
          scope: "namespace",
        });
        assert.equal(binding.namespaceId, f.namespace.id);
        assert.equal(binding.resourceKind, undefined);
        assert.equal(binding.resourceId, undefined);

        const otherNamespace = await f.api("POST", "/namespaces", {
          name: `qa-agent-author-cross-${nameLabel}`,
        });
        await f.waitFor("second Namespace readiness for cross-Namespace denial", async () => {
          const current = await f.api("GET", `/namespaces/${otherNamespace.id}`);
          return current.status === "ready" ? current : undefined;
        });

        assert.deepEqual(
          (await request("GET", "/namespaces")).map(({ id }) => id),
          [f.namespace.id],
        );
        await request("GET", "/installation", undefined, 403);
        await request("GET", `/namespaces/${f.namespace.id}/iam/roles`, undefined, 403);
        const beforeCrossNamespace = await f.api(
          "GET",
          `/namespaces/${f.namespace.id}/iam/access-bindings`,
        );
        await request(
          "POST",
          `/namespaces/${otherNamespace.id}/agents`,
          {
            name: `qa-cross-namespace-${nameLabel}`,
            configurationId: deniedConfiguration.id,
            harnessAuth: {
              method: "api_key",
              source: {
                kind: "secret",
                namespaceId: f.namespace.id,
                id: `sec_${randomUUID()}`,
              },
            },
          },
          403,
        );
        await request("GET", `/namespaces/${otherNamespace.id}/secrets`, undefined, 403);
        assert.equal(
          (await f.api("GET", `/namespaces/${otherNamespace.id}/agents`)).some(
            ({ name }) => name === `qa-cross-namespace-${nameLabel}`,
          ),
          false,
          "a cross-Namespace denial must not persist the Agent",
        );
        assert.deepEqual(
          await f.api("GET", `/namespaces/${f.namespace.id}/iam/access-bindings`),
          beforeCrossNamespace,
          "cross-Namespace denials must not create credential grants",
        );

        const selected = (await request("GET", `/namespaces/${f.namespace.id}/presets`)).find(
          ({ name }) => name === `Standard ${presetName}`,
        );
        assert.ok(selected, `Standard ${presetName} Preset must be readable`);
        const preset = await request("GET", `/namespaces/${f.namespace.id}/presets/${selected.id}`);
        const codex = presetName === "Codex";
        const credential = await protectedText(
          process.env[codex ? "OCC_TEST_QA_CODEX_TOKEN_FILE" : "OCC_TEST_QA_OPENAI_KEY_FILE"],
          "model credential",
        );
        const model =
          process.env[codex ? "OCC_TEST_QA_CODEX_MODEL" : "OCC_TEST_QA_OPENAI_MODEL"] ||
          "gpt-6-luna";
        const rendered = renderPresetTemplate(preset.template, {
          name: `qa-${f.suffix}-${presetName}-${nameLabel}-author`,
          model,
          modelSecret: "provided-through-secret-api",
        });
        const values = rendered.configuration.values;
        values.gateway.http = { endpoints: { chatCompletions: { enabled: true } } };
        values.agents.defaults.skipBootstrap = true;
        const configuration = await request(
          "POST",
          `/namespaces/${f.namespace.id}/configurations`,
          { ...rendered.configuration, kind: "agent" },
          201,
        );
        const secret = await request(
          "POST",
          `/namespaces/${f.namespace.id}/secrets`,
          { name: `${rendered.agent.name}-model`, value: credential },
          201,
        );
        const harnessAuth = {
          method: codex ? "codex_pat" : "api_key",
          source: { kind: "secret", namespaceId: f.namespace.id, id: secret.id },
        };

        const restrictionId = `qa-agent-author-${randomUUID()}`;
        // Restrictions have no public creation route; seed one policy row, then exercise its
        // decision through the real signed-in API before the row is removed.
        await f.database(
          `INSERT INTO occ.iam_restrictions
             (id, namespace_id, action, resource_kind, resource_id, effect)
           VALUES (:'id', :'namespace_id', 'create', 'agent', NULL, 'deny')`,
          { id: restrictionId, namespace_id: f.namespace.id },
        );
        const beforeRestrictedCreate = await f.api(
          "GET",
          `/namespaces/${f.namespace.id}/iam/access-bindings`,
        );
        try {
          await request(
            "POST",
            `/namespaces/${f.namespace.id}/agents`,
            {
              ...rendered.agent,
              configurationId: deniedConfiguration.id,
              harnessAuth: {
                ...harnessAuth,
                source: { ...harnessAuth.source, id: `sec_${randomUUID()}` },
              },
            },
            403,
          );
          assert.deepEqual(
            await f.api("GET", `/namespaces/${f.namespace.id}/iam/access-bindings`),
            beforeRestrictedCreate,
            "a Restriction denial must happen before credential grants are written",
          );
          assert.equal(
            (await f.api("GET", `/namespaces/${f.namespace.id}/agents`)).some(
              ({ name }) => name === rendered.agent.name,
            ),
            false,
            "a Restriction denial must not persist the Agent",
          );
        } finally {
          await f.database("DELETE FROM occ.iam_restrictions WHERE id = :'id'", {
            id: restrictionId,
          });
        }

        const createAgentUrl = `${f.consoleUrl}/console/agents/new?namespace=${f.namespace.id}`;
        await authorPage.goto(`${f.consoleUrl}/console/?namespace=${f.namespace.id}`);
        const agentsHeading = authorPage.getByRole("heading", { name: "Agents", exact: true });
        await agentsHeading.waitFor();
        await authorPage.goto(createAgentUrl);
        const createHeading = authorPage.getByRole("heading", {
          name: "Create Agent",
          exact: true,
        });
        await createHeading.waitFor();
        const mediaPrefix = `${f.controlPlane}-${presetName.toLowerCase()}-${f.suffix}-agent-author`;
        await authorPage.screenshot({
          path: join(artifactsDirectory, `${mediaPrefix}-before.png`),
        });
        const defaultPreset = authorPage.getByRole("button", {
          name: "Start with default Preset",
          exact: true,
        });
        const modelSecret = authorPage.getByLabel(
          codex ? "Service account token Secret" : "API key Secret",
          { exact: true },
        );
        await authorPage.goto(`${f.consoleUrl}/console/?namespace=${f.namespace.id}`);
        await agentsHeading.waitFor();
        const createAgent = authorPage.getByRole("button", {
          name: "Create Agent",
          exact: true,
        });
        await recordWalkthrough(authorPage, {
          outputPath: join(artifactsDirectory, `${mediaPrefix}-credential-access.webm`),
          ready: () => agentsHeading.waitFor(),
          steps: [
            {
              target: createAgent,
              action: () => createAgent.click(),
              verify: () => createHeading.waitFor(),
            },
            {
              target: defaultPreset,
              action: () => defaultPreset.click(),
              verify: () => modelSecret.waitFor({ state: "visible" }),
            },
            {
              target: modelSecret,
              action: async () => {
                await modelSecret.fill(secret.name);
                await authorPage.getByRole("option", { name: secret.name, exact: true }).click();
              },
              verify: async () => {
                assert.equal(await modelSecret.inputValue(), secret.name);
                await authorPage
                  .getByText("Secret selected. Create Agent binds it.", { exact: true })
                  .waitFor({ state: "visible" });
              },
            },
          ],
        });
        await authorPage.screenshot({
          path: join(artifactsDirectory, `${mediaPrefix}-after.png`),
        });
        const agent = await request(
          "POST",
          `/namespaces/${f.namespace.id}/agents`,
          {
            ...rendered.agent,
            configurationId: configuration.id,
            harnessAuth,
          },
          201,
        );
        Object.assign(agent, {
          preset: presetName,
          qaScenario: nameSuffix,
          configuration,
          harnessAuth,
        });
        f.agents.push(agent);

        const confirmed = await request(
          "PATCH",
          `/namespaces/${f.namespace.id}/agents/${agent.id}`,
          { configurationId: configuration.id },
        );
        assert.equal(confirmed.id, agent.id, "Agent Author can update an Agent");
        await request(
          "POST",
          `/namespaces/${f.namespace.id}/agents/${agent.id}/runtime-credentials`,
          {},
        );
        const revision = await request(
          "POST",
          `/namespaces/${f.namespace.id}/agents/${agent.id}/deploy`,
          undefined,
          202,
        );
        await f.deployAndWait(agent, { revision });
        const bindings = await f.api("GET", `/namespaces/${f.namespace.id}/iam/access-bindings`);
        assert.ok(
          bindings.some(
            (candidate) =>
              candidate.subjectId === agent.servicePrincipalId &&
              candidate.resourceKind === "secret" &&
              candidate.resourceId === secret.id,
          ),
          "the Agent ServicePrincipal must receive its exact model Secret grant",
        );
        assert.equal(
          bindings.some(
            (candidate) =>
              candidate.subjectId === agent.servicePrincipalId &&
              candidate.resourceKind === "secret" &&
              candidate.resourceId !== secret.id,
          ),
          false,
          "the Agent ServicePrincipal must not receive unrelated Secret grants",
        );
        await verify(agent, request);

        const replacementSecret = await request(
          "POST",
          `/namespaces/${f.namespace.id}/secrets`,
          { name: `${rendered.agent.name}-model-replacement`, value: credential },
          201,
        );
        const replacement = await request(
          "PATCH",
          `/namespaces/${f.namespace.id}/agents/${agent.id}`,
          {
            configurationId: configuration.id,
            harnessAuth: {
              ...harnessAuth,
              source: { ...harnessAuth.source, id: replacementSecret.id },
            },
          },
        );
        assert.equal(replacement.id, agent.id, "Agent Author can replace model credentials");
        const replacementRevision = await request(
          "POST",
          `/namespaces/${f.namespace.id}/agents/${agent.id}/deploy`,
          undefined,
          202,
        );
        await f.deployAndWait(agent, { revision: replacementRevision });
        // Activation of the replacement is the cleanup boundary for the old exact Secret grant.
        const replacementBindings = await f.api(
          "GET",
          `/namespaces/${f.namespace.id}/iam/access-bindings`,
        );
        assert.ok(
          replacementBindings.some(
            (candidate) =>
              candidate.subjectId === agent.servicePrincipalId &&
              candidate.resourceKind === "secret" &&
              candidate.resourceId === replacementSecret.id,
          ),
          "the active replacement must retain only its exact model Secret grant",
        );
        assert.equal(
          replacementBindings.some(
            (candidate) =>
              candidate.subjectId === agent.servicePrincipalId &&
              candidate.resourceKind === "secret" &&
              candidate.resourceId === secret.id,
          ),
          false,
          "activation cleanup must remove the previous model Secret grant",
        );
        await verify(agent, request);

        // Revocation denies later human requests; the administrator still owns test cleanup.
        await f.api("DELETE", `/namespaces/${f.namespace.id}/iam/access-bindings/${binding.id}`);
        const beforeRevokedRequests = await f.api(
          "GET",
          `/namespaces/${f.namespace.id}/iam/access-bindings`,
        );
        await request(
          "PATCH",
          `/namespaces/${f.namespace.id}/agents/${agent.id}`,
          {
            configurationId: configuration.id,
            harnessAuth: {
              ...harnessAuth,
              source: { ...harnessAuth.source, id: `sec_${randomUUID()}` },
            },
          },
          403,
        );
        await request(
          "GET",
          `/namespaces/${f.namespace.id}/secrets/${replacementSecret.id}`,
          undefined,
          403,
        );
        assert.deepEqual(
          await f.api("GET", `/namespaces/${f.namespace.id}/iam/access-bindings`),
          beforeRevokedRequests,
          "revoked requests must not create or alter credential grants",
        );

        await f.api("POST", `/namespaces/${f.namespace.id}/agents/${agent.id}/stop`);
        await f.api("DELETE", `/namespaces/${f.namespace.id}/agents/${agent.id}`, undefined);
        await f.waitFor("Agent Author Agent deletion", async () => {
          const agents = await f.api("GET", `/namespaces/${f.namespace.id}/agents`);
          return !agents.some(({ id }) => id === agent.id);
        });
        agent.stopped = true;
        await f.record(`${presetName}-agent-author`, {
          principalId,
          namespaceId: f.namespace.id,
          agentId: agent.id,
          revisionId: revision.id,
          explicitRoleAssignment: true,
          unassignedCreateDeniedBeforeCredentialLookup: true,
          crossNamespaceCreateAndSecretReadDenied: true,
          restrictionDeniedBeforeCredentialLookup: true,
          installationAccessDenied: true,
          iamEditingDenied: true,
          exactCredentialGrant: true,
          replacementActivated: true,
          previousCredentialGrantCleanedAfterActivation: true,
          revokedCredentialAccessDenied: true,
          createdUpdatedDeployedStoppedDeleted: true,
        });
      } finally {
        await authorContext.close();
      }
    },
    async verifySecrets(agent) {
      const secretsPage = await browser.newPage();
      const base = `/namespaces/${agent.namespaceId}`;
      const name = `qa-console-${randomUUID()}`;
      const syntheticValue = `synthetic-console-${randomUUID()}`;
      const configurationPath = `${base}/configurations/${agent.configurationId}`;
      const configuration = await f.api("GET", configurationPath);
      let secret;
      let configurationChanged = false;
      try {
        await secretsPage.goto(`${f.consoleUrl}/console/secrets?namespace=${agent.namespaceId}`);
        await secretsPage.getByRole("button", { name: "Create Secret", exact: true }).click();
        const create = secretsPage.getByRole("dialog", { name: "Create Secret", exact: true });
        await create.getByLabel("Secret name", { exact: true }).fill(name);
        await create.getByLabel("Value", { exact: true }).fill(syntheticValue);
        await create.getByRole("button", { name: "Create Secret", exact: true }).click();
        await secretsPage
          .getByRole("dialog", { name: "Secret created", exact: true })
          .getByRole("button", { name: "Close" })
          .click();
        secret = (await f.api("GET", `${base}/secrets`)).find((item) => item.name === name);
        assert.ok(secret, "console-created Secret must be persisted by the shipped controller");
        await secretsPage.getByRole("button", { name, exact: true }).click();
        await secretsPage
          .getByRole("dialog", { name, exact: true })
          .getByRole("button", { name: "Replace value", exact: true })
          .click();
        const replace = secretsPage.getByRole("dialog", {
          name: "Replace Secret value",
          exact: true,
        });
        await replace.getByLabel("Value", { exact: true }).fill(`${syntheticValue}-replacement`);
        await replace.getByRole("button", { name: "Replace value", exact: true }).click();
        await secretsPage
          .getByRole("dialog", { name: "Secret value replaced", exact: true })
          .getByRole("button", { name: "Close" })
          .click();

        // Change this scenario's Agent draft Configuration, leaving the active revision intact.
        // The real Configuration admission and stored reference must prevent Secret deletion.
        configurationChanged = true;
        await f.api("PATCH", configurationPath, {
          values: configuration.values,
          secretBindings: {
            ...configuration.secretBindings,
            QA_CONSOLE_SECRET: { source: secret.ref },
          },
        });
        await secretsPage.getByRole("button", { name, exact: true }).click();
        const detail = secretsPage.getByRole("dialog", { name, exact: true });
        await detail.getByText(agent.configurationId, { exact: true }).waitFor();
        assert.equal(
          await detail.getByRole("button", { name: "Delete Secret", exact: true }).isDisabled(),
          true,
        );
        // Bypass the disabled control to verify the actual server also rejects the reference.
        const refused = await secretsPage.evaluate(
          async (path) => (await fetch(path, { method: "DELETE" })).status,
          `${base}/secrets/${secret.id}`,
        );
        assert.equal(refused, 409);
        await detail.getByRole("button", { name: "Close" }).click();
        await f.api("PATCH", configurationPath, {
          values: configuration.values,
          secretBindings: configuration.secretBindings ?? {},
        });
        configurationChanged = false;
        await secretsPage.getByRole("button", { name, exact: true }).click();
        await secretsPage
          .getByRole("dialog", { name, exact: true })
          .getByRole("button", { name: "Delete Secret", exact: true })
          .click();
        await secretsPage
          .getByRole("dialog", { name: "Delete Secret", exact: true })
          .getByRole("button", { name: "Permanently delete Secret", exact: true })
          .click();
        await secretsPage.getByRole("dialog", { name: "Secret deleted", exact: true }).waitFor();
        assert.equal(
          (await f.api("GET", `${base}/secrets`)).some((item) => item.id === secret.id),
          false,
        );
        await f.record(`${agent.preset}-console-secrets`, {
          agentId: agent.id,
          configurationId: agent.configurationId,
          secretId: secret.id,
          created: true,
          replaced: true,
          referenceBlockedDeletion: true,
          deleted: true,
        });
        secret = null;
      } finally {
        try {
          if (configurationChanged) {
            await f.api("PATCH", configurationPath, {
              values: configuration.values,
              secretBindings: configuration.secretBindings ?? {},
            });
          }
          // A lost creation reply can leave an owned Secret before its ID was read.
          const owned = (await f.api("GET", `${base}/secrets`)).find((item) => item.name === name);
          if (owned) {
            await f.api("DELETE", `${base}/secrets/${owned.id}`);
          }
        } finally {
          await secretsPage.close();
        }
      }
    },
    async verifyNamespaceDeletionBlockers(agent) {
      const namespacesPage = await browser.newPage();
      try {
        const namespace = await f.api("GET", `/namespaces/${agent.namespaceId}`);
        await namespacesPage.goto(`${f.consoleUrl}/console/namespaces?namespace=${namespace.id}`);
        await namespacesPage
          .getByRole("button", { name: `Delete ${namespace.name}`, exact: true })
          .click();
        const refused = namespacesPage.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/namespaces/${namespace.id}` &&
            response.request().method() === "DELETE",
        );
        await namespacesPage.getByRole("button", { name: "Delete Namespace", exact: true }).click();
        assert.equal((await refused).status(), 409);
        // A deployed Agent in this run's Namespace must block real teardown and appear in the dialog.
        const blockers = namespacesPage.getByRole("dialog", {
          name: "Namespace still contains resources",
          exact: true,
        });
        await blockers.getByText(agent.id, { exact: true }).waitFor();
        await blockers.getByText(agent.configurationId, { exact: true }).waitFor();
        assert.equal((await f.api("GET", `/namespaces/${namespace.id}`)).status, "ready");
        await blockers.getByRole("button", { name: "View Agents", exact: true }).click();
        assert.equal(new URL(namespacesPage.url()).searchParams.get("namespace"), namespace.id);
        await namespacesPage.getByRole("link", { name: agent.name, exact: true }).waitFor();
        await f.record(`${agent.preset}-console-namespace-deletion`, {
          namespaceId: namespace.id,
          agentId: agent.id,
          configurationId: agent.configurationId,
          nonemptyDeletionRefused: true,
          cleanupNavigationScoped: true,
        });
      } finally {
        await namespacesPage.close();
      }
    },
    async verify(agent) {
      assert.equal(await page.locator(".sidebar .brand-name").textContent(), "Example Agents");
      assert.equal(
        await page.locator(".sidebar .brand img").getAttribute("src"),
        "/console/theme/logo.png",
      );
      const gateway = await f.gatewayUrl(agent);
      let origin = nativeOrigin;
      if (f.controlPlane === "compose") {
        upstream = new URL(gateway.url);
      } else {
        const path = `/namespaces/${agent.namespaceId}/agents/${agent.id}/native-admin`;
        const status = await page.evaluate(async (path) => {
          const response = await fetch(path);
          return { status: response.status, body: await response.json() };
        }, path);
        assert.equal(status.status, 200);
        assert.equal(status.body.data.status, "available");
        assert.equal(status.body.data.activeRevisionId, agent.revision.id);
        origin = status.body.data.origin;
      }
      const native = await browser.newPage();
      const frames = [];
      native.on("websocket", (socket) => {
        assert.equal(new URL(socket.url()).origin, origin.replace(/^http/, "ws"));
        socket.on("framereceived", (frame) => frames.push(frame));
      });
      try {
        const response = await native.goto(origin);
        assert.ok(response?.ok(), "native UI must load through its trusted endpoint");
        const authenticate =
          f.controlPlane === "compose"
            ? async () => {
                const credential = native.locator("#login-gate-credential");
                await credential.waitFor({ state: "attached", timeout: 60_000 });
                // The stock login failure view nests credentials in a collapsed
                // connection disclosure. Wait for that view before opening it.
                if (!(await credential.isVisible())) {
                  await native.locator("details.login-gate__connection > summary").click();
                }
                await credential.fill(gateway.gatewayPassword);
                await native.getByRole("button", { name: "Connect", exact: true }).click();
              }
            : undefined;
        await waitForStockUi(native);
        const nonce = `QA_NATIVE_${randomUUID()}`;
        await submitChatTurnWithAssistantProof(native, nonce, frames, waitFor, authenticate);
        const current = await f.pod(agent, "gateway");
        assert.equal(current.metadata.uid, gateway.pod.metadata.uid);
        await f.record(`${agent.preset}-native-ui`, {
          agentId: agent.id,
          revisionId: agent.revision.id,
          podUid: current.metadata.uid,
          origin,
          trustedTls: true,
          assistantNonce: nonce,
          receivedFrames: frames.length,
        });
      } finally {
        await native.close();
        await gateway.close();
      }
    },
  };
}
