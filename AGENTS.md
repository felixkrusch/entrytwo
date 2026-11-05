# Project Agent Instructions

## Next.js

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

These instructions are maintained in Git. `agentRules: false` in `next.config.ts`
disables Next.js-managed blocks so development startup does not rewrite this file.

## Installation and Operations

Read [README.md](./README.md), [docs/SETUP.md](./docs/SETUP.md), and the local
[installation skill](./skills/entrytwo/SKILL.md) before provisioning an instance.
[llms.txt](./llms.txt) indexes repository-local instructions for clone-only agents.
Use Node.js 22.12+ (22.x) or 24.x. Never seed, reset, or replace a database with
real records. Never print credentials, session cookies, or encryption keys.
