# Nexa Email Inbox

A shared mailbox for your organization's Nexa addresses. Receive external correspondence, read attachments, reply, compose and save drafts, search, star, archive and delete mail. Messages and attachments live in a SQLite Durable Object in **your own Cloudflare account**.

[Interactive preview](https://nexa-email-inbox.nexa-templates.workers.dev/) · [Use with Nexa](https://admin.nexaintel.work)

![Email inbox preview](preview.webp)

## Set up through Nexa

The Nexa Templates organization maintains and publishes this template. Its deployed website runs with `PREVIEW_MODE: "true"`: anyone can explore fictional mail, search, attachments, drafts, folders and simulated sending without signing in. Preview changes stay in that visitor's browser and can be reset. The server blocks every live mailbox API; preview requests and scheduled jobs never access Nexa Email or the mailbox database. No email is received or delivered by the preview. GitHub Pages is not used.

1. Import this repository as a project in your organization; preserve the upstream history. Configure a unique Worker name and set `vars.PREVIEW_MODE` to `"false"` in `wrangler.jsonc` for a real mailbox.
2. Keep **Nexa project sign-in enabled** and grant the intended users access to this project. All approved project users share its mailbox. With preview disabled, missing sign-in configuration fails closed; arbitrary identity headers do not authorize access. Preview never opens the real mailbox, even when service credentials are installed.
3. In **Project → Services**, enable Email and choose **Set up project access**. This installs runtime-only `NEXA_SERVICE_KEY` and `NEXA_SERVICE_ORIGIN` with Send and Receive email permissions. Existing installations need setup again to add Receive email, then redeployment. Never commit or expose the key in browser code.
4. In Nexa **Build & deploy**, select the connected Worker and production branch, use `/` as the root, `bun install --frozen-lockfile` to install, `bun test && bun run build` to build, and `npx --no-install wrangler deploy --name "$NEXA_WORKER_NAME"` to deploy. Enable automatic deployments, run the initial build, and follow its exact commit to success with a saved deployment and Visit URL. Later production-branch pushes use the same pipeline. Authentication is built into the source: the installed receive credential registers sign-in only after Nexa verifies the Worker hostname through Cloudflare. Each real mailbox request checks current project membership and session validity. There is no separate login secret to copy.
5. In **Settings → General → Organization email**, add an alias such as `company+accounting@nexaintel.work` and select this project. Click **Refresh & sync** in the inbox. A scheduled job also syncs every minute.

Nexa supplies email sending and reception. No customer Workers Paid subscription or separate mailbox-provider account is required for setup. Customer Workers CPU/request and SQLite storage limits still apply; large MIME messages or heavy traffic may require additional capacity. Do not use another customer's database or the public preview's data.

## Run and build

Node.js 22+ and Bun for tests:

```sh
bun install --frozen-lockfile
bun run build        # static assets in dist/
bun test             # mailbox persistence/retry/access tests
bun run dev          # public preview; real mode needs a test auth provider
```

The Worker entry is `src/worker.js`, with the `MAILBOX` SQLite Durable Object and an initial migration. `index.html`, `mail.css`, `styles.css` and `app.js` contain the interface. `preview.js` supplies the separate browser-only sample mailbox; `src/preview.js` rejects access to real mail while preview is enabled. Use `bun run dev` to test the preview through the Worker.

## Mail handling

- Selected aliases receive external mail. `company+agent@…` is reserved for the AI coworker and its authorized Team senders. Ordinary inbox mail never starts an AI task. Organization addresses require `+alias`; bare addresses are not supported.
- Nexa temporarily encrypts queued MIME messages, up to 5 MiB including attachments. This app saves each message and its attachments in a transaction **before** acknowledging it. A failed sync retries the same delivery ID. Queued mail expires after 30 days; monitor the sync status and Nexa Settings delivery status.
- Customer mailbox storage keeps messages until permanent deletion. The initial app cap is 512 MiB of raw messages and 10,000 messages, plus at most 100 drafts of 800 KB each. Draft attachments total at most 512 KiB in the interface. Move mail to Trash before permanent deletion. Download original incoming MIME, sent-message JSON, and individual attachments before deleting data you need.
- Sending supports one recipient, owned organization aliases, text, attachments, and reply threading. CC/BCC, IMAP/provider connections, custom domains, automatic spam classification, remote images, automatic bounce processing and full mailbox export are not included. Search covers sender, subject and the stored text preview.
- Every send uses one persistent idempotency key. Once attempted, its content is locked. Unconfirmed sends remain visible and cannot be deleted; checking them uses the same key and never starts a new send. An accepted result means provider acceptance, not delivery. Rejected drafts can be deleted and replaced after correcting the issue. Space is reserved before sending so a full mailbox cannot prevent saving its sent record.
- HTML is opt-in in a sandbox with scripts, forms and remote images disabled. Attachments download as files. Sender authentication is shown separately from message content; it does not establish that an attachment is safe.

## Verification

`tests/mailbox.test.js` covers save-before-ack and lost acknowledgements, attachments, draft conflicts, uncertain sends, immutable retries, capacity checks, exports, and signed identity enforcement. Nexa's integration checks also run the real local Worker/SQLite DO and browser across light/dark desktop and mobile sizes, with a simulated email provider. They do not send real email or demonstrate deliverability for a customer's domain/provider.

## Releases

- **0.2.0** — Nexa alias mailbox, customer-owned persistence, protected sign-in, drafts/sending/attachments, retry accounting and responsive UI.
- **0.1.0** — Static visual starter with sample messages.

MIT licensed. See `LICENSE`.
