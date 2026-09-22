// Placeholder. The build moves here from valbuild/home's @valbuild/builder
// and @valbuild/wire — see docs/app-mode.md in valbuild/home, the
// `build-package` chunk. Published early and empty so that its npm trusted
// publisher exists before CI ever needs it: a package with no configuration
// answers an unauthorized PUT with 404, which reads as "no such package".
export {};
