# Releasing Simple Days

Repository: https://github.com/ChenXiaoW/simple-days

## Verify before publishing

1. Review the source, documentation, and MIT license.
2. Run `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, and `npm run check:release`.
3. Test the build in a separate vault, including daily-note synchronization and any platform you intend to support.
4. Check that `manifest.json`, `package.json`, the lockfile, and `versions.json` agree on the version. Every version listed in `versions.json` must have corresponding downloadable release assets. Earlier prototype IDs are not listed.
5. Commit source and documentation. Never upload personal `data.json`, an Obsidian vault, credentials, or `node_modules`.

## Publish a GitHub release

After pushing the reviewed source to the default branch, create a tag matching the manifest version exactly:

```sh
git tag 0.6.12
git push origin 0.6.12
```

The release workflow builds and checks the tag, generates GitHub provenance attestations for `main.js`, `manifest.json`, and `styles.css`, and verifies their signatures before creating a **draft** release with those files attached separately. Review the draft in GitHub, enter release notes, and publish it as a normal release. A draft or a ZIP file alone is insufficient for installing through Obsidian.

Use the workflow to retain verified provenance; uploading replacement files manually can break the link to the attested digests. The tag must be `0.6.12`, not `v0.6.12`. Keep `manifest.json` committed at the repository root as well as attached to the release.

For later releases, increment the version in `manifest.json`, `package.json`, and the lockfile; add the new version-to-minimum-Obsidian mapping to `versions.json`; update the changelog; then repeat these checks.

## Submit to the Obsidian Community directory

Current official instructions: https://docs.obsidian.md/plugins/releasing/submit-plugin

1. Publish the GitHub release and ensure the repository is public.
2. Sign in at https://community.obsidian.md with the owner's Obsidian account.
3. Link the GitHub account `ChenXiaoW` to verify repository ownership.
4. Add the plugin using repository `ChenXiaoW/simple-days`.
5. Confirm that the directory accepts the unique ID `simple-days` and display name `Simple Days`. Naming availability must be checked at submission time.
6. Address review feedback, increment the version, and publish updated release assets as needed.
7. Publish the directory entry when review requirements are met. A successful GitHub push does not mean the plugin is listed.

The directory reads `manifest.json` from the default branch and installs release assets using its version. Keep both in sync. Do not use an old tutorial's `obsidian-releases` pull-request instructions in place of the current submission guide.
