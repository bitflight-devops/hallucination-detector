## [1.12.3](https://github.com/bitflight-devops/hallucination-detector/compare/v1.12.2...v1.12.3) (2026-03-17)

### Bug Fixes

- **hooks:** remove explicit hooks declaration — auto-discovery handles it ([f976e5d](https://github.com/bitflight-devops/hallucination-detector/commit/f976e5dc8fabbab0e33565643e044f3a781b7c1b))

## [1.12.2](https://github.com/bitflight-devops/hallucination-detector/compare/v1.12.1...v1.12.2) (2026-03-17)

### Bug Fixes

- **detection:** reduce false positives and improve block UX ([#44](https://github.com/bitflight-devops/hallucination-detector/issues/44)) ([b28c2ab](https://github.com/bitflight-devops/hallucination-detector/commit/b28c2ab87b6147cf092297c1a68379c2787d011f))

## [1.12.1](https://github.com/bitflight-devops/hallucination-detector/compare/v1.12.0...v1.12.1) (2026-03-16)

### Bug Fixes

- **detection:** use last_assistant_message from stdin, add direct-wrap suppression ([de5d21a](https://github.com/bitflight-devops/hallucination-detector/commit/de5d21a3ab8f406e493d862fad1feef1e120696f))

## [1.12.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.11.0...v1.12.0) (2026-03-15)

### Features

- cascading configuration system for hallucination-detector ([#42](https://github.com/bitflight-devops/hallucination-detector/issues/42)) ([f5a1afb](https://github.com/bitflight-devops/hallucination-detector/commit/f5a1afb6b55d29dc0a8b539d8ad969b84e328686))

## [1.11.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.10.1...v1.11.0) (2026-03-11)

### Features

- **detection:** tighten ANSWER enforcement, evidence quality, and prefix normalization ([2ee5adb](https://github.com/bitflight-devops/hallucination-detector/commit/2ee5adbe1f666d60271996a0c7e375e10b6cbe55))

## [1.10.1](https://github.com/bitflight-devops/hallucination-detector/compare/v1.10.0...v1.10.1) (2026-03-11)

### Bug Fixes

- **detection:** remove "nothing left to do" from completeness triggers ([1a16d0c](https://github.com/bitflight-devops/hallucination-detector/commit/1a16d0ca142ac5707a10ad5a6997330189257332))

## [1.10.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.9.0...v1.10.0) (2026-03-10)

### Features

- **detection:** add structured claim annotation and persistence gating ([bc20244](https://github.com/bitflight-devops/hallucination-detector/commit/bc20244a89bce78d84a4be1e5e438400d9a9fcc2))

## [1.9.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.8.0...v1.9.0) (2026-03-10)

### Features

- **detection:** add 'may' as speculation phrase with permissive-usage suppression ([da8b7b6](https://github.com/bitflight-devops/hallucination-detector/commit/da8b7b6ffc723889f92ec0a636515964acb7ef53))

## [1.8.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.7.0...v1.8.0) (2026-03-10)

### Features

- **scripts:** add release latest command ([#37](https://github.com/bitflight-devops/hallucination-detector/issues/37)) ([18487a8](https://github.com/bitflight-devops/hallucination-detector/commit/18487a8c848b7325728adab538c8b937a32b6611))

## [1.7.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.6.0...v1.7.0) (2026-03-10)

### Features

- **scripts:** add pr merge command to gh-api.cjs ([#34](https://github.com/bitflight-devops/hallucination-detector/issues/34)) ([95e3aa8](https://github.com/bitflight-devops/hallucination-detector/commit/95e3aa80076fe04a5ba2c3a745133cec6c73ba88))
- **scripts:** add pr view, table formatting, eliminate gh CLI dependency ([#35](https://github.com/bitflight-devops/hallucination-detector/issues/35)) ([f8d137a](https://github.com/bitflight-devops/hallucination-detector/commit/f8d137afb9d213e944343d2bb4efcf56f9a8d057))
- **scripts:** add run wait and fix pr merge --auto ([#36](https://github.com/bitflight-devops/hallucination-detector/issues/36)) ([c16ec7e](https://github.com/bitflight-devops/hallucination-detector/commit/c16ec7e405c61eda40f289a1e9e9486aa73c777d))

### Bug Fixes

- **stop-hook:** fix EVALUATIVE_DESIGN_TELLS comment and add evidence normalization tests ([#32](https://github.com/bitflight-devops/hallucination-detector/issues/32)) ([9b569af](https://github.com/bitflight-devops/hallucination-detector/commit/9b569af92fc1c944c77f9826b4f378d4d7669a4d))
- **stop-hook:** guard matchAll g-flag and add evaluative-design regression tests ([#33](https://github.com/bitflight-devops/hallucination-detector/issues/33)) ([6afba26](https://github.com/bitflight-devops/hallucination-detector/commit/6afba26347adfdab0b64a8dae07d35c5cc3ac856))
- **stop-hook:** normalize evidence whitespace and iterate all evaluative-design matches ([#31](https://github.com/bitflight-devops/hallucination-detector/issues/31)) ([3226b3e](https://github.com/bitflight-devops/hallucination-detector/commit/3226b3eb082a150de5b83df44e031c88e5100d76))
- **stop-hook:** prevent self-trigger loop and add evaluative design claim detection ([#29](https://github.com/bitflight-devops/hallucination-detector/issues/29)) ([c0c6175](https://github.com/bitflight-devops/hallucination-detector/commit/c0c6175ff5d5110dd4f639411a2736e16f059c21))

## [1.6.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.5.0...v1.6.0) (2026-03-05)

### Features

- add feature request issue template with feature flag enforcement ([75dbc26](https://github.com/bitflight-devops/hallucination-detector/commit/75dbc267b5f7eeeba31bb8e140de24c9390355bf))

## [1.5.0](https://github.com/bitflight-devops/hallucination-detector/compare/v1.4.0...v1.5.0) (2026-03-05)

### Features

- add /start-issue slash command for issue-driven development ([f3f09a3](https://github.com/bitflight-devops/hallucination-detector/commit/f3f09a380836ddf1a9812c820630abf943a59e4d))
- add comment list/view/search commands and CodeRabbit rule ([62b204f](https://github.com/bitflight-devops/hallucination-detector/commit/62b204f13ae11862a47c650772bbfd411cdf4e65))
- add gh skill with octokit-based GitHub project management ([74fa559](https://github.com/bitflight-devops/hallucination-detector/commit/74fa5594ecf1bef738a11b6901b7f66dbe8de0d3))
- add introspection mode for data-driven heuristic refinement ([04477fe](https://github.com/bitflight-devops/hallucination-detector/commit/04477fe8ab3122a4c6b85c51037c0699ab003c48))
- add PR review, code comments, and CI pipeline commands to gh-api.cjs ([938da4b](https://github.com/bitflight-devops/hallucination-detector/commit/938da4b8ad7a4c88a412412b9b2375fbb529e7f9))
- add proxy-aware GitHub API tooling for issue/PR management ([84f7a0c](https://github.com/bitflight-devops/hallucination-detector/commit/84f7a0ccacd565b4f9b03ade1913ebe97c18fc30))
- add reaction support to gh-api.cjs for read-receipt tracking ([669feb7](https://github.com/bitflight-devops/hallucination-detector/commit/669feb79fafabd3e583b685393ca2ed69f0ffa7d))

### Bug Fixes

- add per_page to paginate calls, eliminate extra API call in checksList ([78f6ae2](https://github.com/bitflight-devops/hallucination-detector/commit/78f6ae231b7aa4fff34decb6f3a62d7d7a4ed6f6))
- address CodeRabbit review findings in tests and config ([031c114](https://github.com/bitflight-devops/hallucination-detector/commit/031c114297151527081a89820046cfdb45017d68))
- resolve all Biome warnings and errors across project ([7fc7fc2](https://github.com/bitflight-devops/hallucination-detector/commit/7fc7fc2633220bbf618822c7fe90bebd2bbb15a0))
- resolve Prettier/Biome formatter conflict on JS files ([dedd449](https://github.com/bitflight-devops/hallucination-detector/commit/dedd4493f931ad0543a08f1b4026fb02750a8391))

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
