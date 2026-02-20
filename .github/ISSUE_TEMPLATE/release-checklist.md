---
name: Release Checklist
about: Track release readiness gates before tagging a new version
title: "Release: "
labels: ["release"]
assignees: []
---

## Release Checklist

- [ ] Version label selected
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `./scripts/docs-contract-check.sh` passes
- [ ] `./scripts/seven-shadow-test.sh 2` passes
- [ ] README and CHANGELOG reviewed
- [ ] Security review completed
- [ ] Tag + release notes prepared
