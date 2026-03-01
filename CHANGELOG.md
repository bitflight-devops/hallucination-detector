## [1.4.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.3.2...v1.4.0) (2026-03-01)

### Features

- add issue management utility scripts (JS rewrites from claude_skills) ([42a7d1e](https://github.com/bitflight-devops/hallucination-detector/commit/42a7d1ea646ff9c8f70f89f76c057fdbc7247a36))
- add sentence-level scoring and weighted multi-signal aggregation ([b3b4249](https://github.com/bitflight-devops/hallucination-detector/commit/b3b42498635e30f93943d46307879e53083ce76f))

### Bug Fixes

- add .gitattributes, fix .gitignore negation, format markdown with prettier ([6202897](https://github.com/bitflight-devops/hallucination-detector/commit/620289798eb824a8ec8d4b8c702df1cb58bd2716))
- add language tags to fenced code blocks in CLAUDE.md ([198f45a](https://github.com/bitflight-devops/hallucination-detector/commit/198f45ac33016999622c8ec0085315a05f686622))
- address code review warnings in issue management scripts ([14fb752](https://github.com/bitflight-devops/hallucination-detector/commit/14fb752377fc88816d41b2fcb886a1fa06a8a110))
- correct pre-existing Biome formatting in test files to unblock CI ([90c2ebc](https://github.com/bitflight-devops/hallucination-detector/commit/90c2ebc29b6c317985302fc71cfd51f1626bfce8))
- resolve CI failures in biome, markdownlint, and prettier checks ([9b9685f](https://github.com/bitflight-devops/hallucination-detector/commit/9b9685ff5c5ace98c7a862cb26acf5eb0b73adfa))
- scope prettier to YAML+MD and add project config files ([bbaccad](https://github.com/bitflight-devops/hallucination-detector/commit/bbaccadfc49a770bdb347693aa6fc647321217a2))
- track .claude/rules, skills, and commands in gitignore exceptions ([9618d02](https://github.com/bitflight-devops/hallucination-detector/commit/9618d02fac7590658c7cfd469f76e5992be17b7c))
- validate weights in aggregateWeightedScore/loadWeights; add loadWeights tests; fix test names ([2c729f2](https://github.com/bitflight-devops/hallucination-detector/commit/2c729f2d2399eab551b49401ba21e240750f9561))

## [1.3.2](https://github.com/bitflight-devops/hallucination-detector/compare/v1.3.1...v1.3.2) (2026-02-28)

### Bug Fixes

- collapse keywords array in plugin.json files to satisfy Biome formatter ([376ba04](https://github.com/bitflight-devops/hallucination-detector/commit/376ba042e3e3090d44306197dcf88894c371e9c3))

## [1.3.1](https://github.com/bitflight-devops/hallucination-detector/compare/v1.3.0...v1.3.1) (2026-02-28)

### Bug Fixes

- **deps:** pin minimatch to >=10.2.3 via overrides to address ReDoS vulnerability ([bf5efcf](https://github.com/bitflight-devops/hallucination-detector/commit/bf5efcf910804b3cddd14551e0c78f813fd8aff9)), closes [#16](https://github.com/bitflight-devops/hallucination-detector/issues/16)

## [1.3.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.2.0...v1.3.0) (2026-02-28)

### Features

- add SessionStart hook to inject hallucination-prevention framing ([3cd5014](https://github.com/bitflight-devops/hallucination-detector/commit/3cd50149520e7bfd8f46528c28823eff112d372e))

## [1.2.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.1.3...v1.2.0) (2026-02-28)

### Features

- add CLAUDE.md behavioral framing for hallucination prevention ([b560871](https://github.com/bitflight-devops/hallucination-detector/commit/b560871f2b562d44528775ef79da4bee37a0b419))

## [1.1.3](https://github.com/bitflight-devops/hallucination-detector/compare/v1.1.2...v1.1.3) (2026-02-28)

### Bug Fixes

- reformat plugin.json files to satisfy Biome formatting ([052cdba](https://github.com/bitflight-devops/hallucination-detector/commit/052cdbabac87816d008e96cf94579bf322a3e76b))

## [1.1.2](https://github.com/bitflight-devops/hallucination-detector/compare/v1.1.1...v1.1.2) (2026-02-28)

### Bug Fixes

- allow sibling-only duplicate headings in CHANGELOG.md ([feb0e66](https://github.com/bitflight-devops/hallucination-detector/commit/feb0e668a520d213dc2e5fdafcc40afb8400b158))

## [1.1.1](https://github.com/bitflight-devops/hallucination-detector/compare/v1.1.0...v1.1.1) (2026-02-28)

### Bug Fixes

- resolve shellcheck and markdownlint CI failures ([ef962f3](https://github.com/bitflight-devops/hallucination-detector/commit/ef962f3d909f90ebbc75e84d606626e11cca70d7))

## [1.1.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.0.0...v1.1.0) (2026-02-28)

### Features

- add specialized agents for self-improvement ([0775907](https://github.com/bitflight-devops/hallucination-detector/commit/0775907e296696b69eaf54ad766433f9547b203a))

## 1.0.0 (2026-02-28)

### Features

- initial commit — hallucination-detector plugin ([12651a4](https://github.com/bitflight-devops/hallucination-detector/commit/12651a447283e3bca78e7e300638c56c07473195))
- standalone repo structure with multi-platform support ([c9d97a4](https://github.com/bitflight-devops/hallucination-detector/commit/c9d97a4786d525d081f85ccab9cd12a286ac78cd))
