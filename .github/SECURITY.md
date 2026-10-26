# Security policy

## Supported versions

Security fixes are applied to the latest revision of the default branch. Older commits and private forks are not supported.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. If it is not enabled, contact the repository owner privately and ask for a secure reporting channel before sharing technical details.

Include the affected component, reproducible steps, realistic impact, and any suggested mitigation. Do not access other people's data, disrupt a production bot, publish secrets, or open a public proof of concept before a fix is available.

You should receive an acknowledgement within seven days. Timelines for a fix and coordinated disclosure depend on severity and reproducibility.

## Deployment basics

- Rotate a Discord token immediately if it may have been exposed.
- Keep `.env` and database credentials out of source control and logs.
- Restrict MongoDB to trusted networks and require authentication/TLS in production.
- Run `npm audit --omit=dev` and `npm run validate` before release.
- Apply database indexes with `npm run db:indexes` as a separate deployment step.
- Expose the health server only through a trusted reverse proxy or private network when possible.
