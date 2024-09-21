import ts = require("typescript");

// TODO: Add tooling code here
export default {};

// function getFixes(): Record<
//   SourcePath,
//   { message: string; patches: Patch[] }[]
// > {}
// function getModulePathMap(sourceFile): Record<SourcePath, Span> {}


function getChangedSourcePaths(moduleFilePath, patches): SourcePath[] {

}
function applyFixes(fixes, source): Record<SourcePath, Source> {
  // actually apply the fixes

  // get all changed source paths

  // return the source paths and their new source
}

function transformSourceToCode(source: Source): ts.Node {
  
}


const validationErrors = schema.validate(source)
const fixes = getFixes(validationErrors, (filePath, encoding?: 'utf-8') => {
  return fs.readSync(filePath, encoding)
})
const applyFixes(fixes, source)
