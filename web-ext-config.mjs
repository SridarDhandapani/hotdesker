// Shared config for `web-ext lint`, `web-ext build`, `web-ext sign`,
// and `web-ext run`. Keeps the Chrome zip and Firefox xpi exclusion
// lists in lockstep so neither store package ships repo-only files
// like CLAUDE.md or docs/.

export default {
  ignoreFiles: [
    ".git",
    ".github",
    ".gitignore",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "CLAUDE.md",
    "WEBSTORE_LISTING.md",
    "AMO_LISTING.md",
    "SCREENSHOTS.md",
    "docs/**",
    "dist/**",
    ".DS_Store",
    "web-ext-config.mjs",
    "web-ext-artifacts/**",
    ".claude/**",
  ],
};
