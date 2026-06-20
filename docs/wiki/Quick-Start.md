# Quick Start

This page gives you the shortest path, with a single goal: getting NodeWarden up and running as quickly as possible.

If this is your first deployment, we recommend starting with the default R2 mode. If your Cloudflare account doesn't have R2 enabled yet, or you'd rather not add a payment card, you can use KV mode instead.

## Choosing Between R2 and KV

   | Storage | Card required | Max single attachment / Send file | Free tier |
   |---|---|---|---|
   | R2 | Yes | 100 MB (soft limit, can be changed) | 10 GB |
   | KV | No | 25 MiB (Cloudflare limit) | 1 GB |


## Before You Deploy

Before you start, you'll need the following:

- A GitHub account
- A Cloudflare account
- A working pair of hands (one will do)

## The Easiest Way: One-Click Web Deploy

This is the best path for most users.

1. Fork the `NodeWarden` repository to your own GitHub account
2. Go to the Cloudflare Workers creation page
3. Choose `Continue with GitHub`
4. Select the repository you just forked
5. Keep the default configuration and continue deploying
6. If you plan to use KV mode, change the deploy command to `npm run deploy:kv`
7. Once the deployment finishes, open the generated Workers domain
8. Follow the on-page prompts to set `JWT_SECRET` — don't just throw in a temporary, random value. This value directly affects the security of token issuance; for a production environment, use a random string of at least 32 characters.

## Command-Line Deployment

If you prefer local development or manual publishing, you can use the CLI:

```powershell
git clone https://github.com/shuaiplus/NodeWarden.git
cd NodeWarden
npm install
npx wrangler login

# Uses R2 by default
npm run deploy

# Optional: KV mode
npm run deploy:kv
```

For local development, or to recover passwords when Cloudflare is down, you can run the demo locally:

```powershell
npm run dev
npm run dev:kv
```

## Upgrading and Syncing Upstream

If you deployed from a forked repository, the most natural way to upgrade later is to sync the upstream code.

- Sync manually with `Sync fork -> Update branch`
- Enable the `Sync upstream` workflow in the repository's Actions

If you don't modify the source code, automatic syncing is very convenient. If you've made your own customizations, we recommend sticking with manual syncing, which makes it easier to review changes before upgrading.
