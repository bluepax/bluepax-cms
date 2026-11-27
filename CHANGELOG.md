# Changelog

All notable changes to this project are documented in this file.

## 1.0.0-beta.34 - 2026-11-27

### Features

- **core:** Add module manifest and registry
- **db:** Add core schema and locked startup migrations
- **cms:** Add sveltekit app with startup and health endpoint
- **users:** Add accounts, roles, sessions and the admin shell
- **presets:** Add corporate and blog presets and the instance config format
- **cms:** Add the setup wizard and unattended initialisation
- **presets:** Add publisher, brand terms and instant messaging to the site config
- **db:** Add the site tables for legal entities, locations and navigation
- **site:** Add the site settings module and admin pages
- **storage:** Add the storage driver interface and the local driver
- **db:** Add the media tables
- **presets:** Add the media cache lifetime and upload limits to the storage config
- **media:** Add the media library on local storage
- **cms-blocks:** Define the standard blocks and rich text with zod
- **pages:** Add block pages with language versions, status and seo panel
- **posts:** Add posts, categories, tags and authors
- **site:** Explain the publisher image fallbacks in the settings
- **presets:** Validate route templates and build frontend paths
- **site:** Edit route templates and resolve frontend paths
- **api:** Add delivery tokens and the preview secret
- **api:** Serve the delivery api with seo objects and safe html
- **api:** Add the integration page and preview links
- **cms-client:** Add the typed delivery api client
- **minimal-site:** Add the minimal sveltekit frontend example
- **db:** Back up the database with pg_dump before migrations
- **cms:** Back up before migrating and check deployment settings at startup

### Bug fixes

- **core:** Accept only object.event webhook event names
- **cms:** Import shadcn and animation styles by path
- **deps:** Update sharp to 0.35.5 for the librsvg vulnerability
- **storage:** Trim trailing slashes without a backtracking regex
- **presets:** Trim the frontend base URL without a backtracking regex
- **users:** Check e-mail addresses without a backtracking regex
- **posts:** Stop running parallel queries on one transaction client

### Documentation

- Add design specification
- Add readme, license and contribution guides
- Add code of conduct
- Publish npm packages to github packages
- Document the development database and migrations
- Add architecture decision records and contributor details
- Sync the specification with the design document
- Describe the owner workflow and the settled license rule
- Run the production build before every push
- Record the instance config and setup decisions
- Record the site settings decisions
- Record the media module decisions
- **pages:** Record the block page decisions in adr 0009
- **posts:** Record the posts decisions in adr 0010
- **site:** Keep the publisher image out of the instance config
- **site:** Record the route template decisions in adr 0011
- **api:** Record the delivery api decisions in adr 0012
- **cms-client:** Record the sdk and package decisions in adr 0013
- **minimal-site:** Record the example frontend decisions in adr 0014
- **deploy:** Document the deployment and record the decisions in adr 0015
- Record the m1 acceptance and the decisions in adr 0016

### Reverts

- Undo the unconventional funding username commit

### Other

- Set up pnpm workspace and tooling
- Add ci, codeql and dependabot configuration
- Publish releases to github packages with the workflow token
- Check licenses of all workspace packages
- Lint and format svelte files
- Run integration tests on postgres and build the app
- Run the release script tests next to the workspace projects
- Skip commit message rules for dependabot commits
- Fix the github username in funding.yml
- Run the production build in the pre-push hook
- **media:** Give the image processing tests more time
- **api:** Check delivered media urls without hostname regexes
- **cms-blocks:** Publish the package with built files and json schemas
- **deploy:** Add the image and the docker compose quick start
- **release:** Build and push the image to GHCR
- **deps:** Bump the minor-and-patch group with 5 updates
- **deps:** Bump jsdom from 30.1.3 to 31.0.1
- **deps:** Bump tailwind-variants from 3.3.1 to 4.0.2
- **api:** Reject response fields the delivery contract does not describe
- **users:** Check the admin routes with the seeded editor role
- Add playwright end-to-end tests of the m1 flows
- **db:** Fail database tests on overlapping queries on one client

