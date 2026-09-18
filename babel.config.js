/** @type {import("@babel/core").TransformOptions} */
module.exports = {
  presets: [
    "@babel/preset-env",
    // `allowDeclareFields` permits `declare foo: T` class fields, which are
    // type-only and emit nothing. Val uses them for phantom markers a type
    // needs and an instance must not have — see `__declaresRecordKeys` on
    // `LocaleSchema`. It is the default in Babel 8.
    //
    // It is NOT free, and the first version of this comment claimed it was.
    // The flag also changes what an uninitialized field WITHOUT `declare`
    // compiles to: `foo: T;` was erased and is now emitted, which defines the
    // property as `undefined` after `super()` returns. Where a base constructor
    // assigns that name, the subclass's field would now overwrite it.
    //
    // Checked before turning it on, not assumed: 38 such fields across 15
    // files, 6 of them in a class that extends something —
    // `RecordSchema.declaredKeys`, `ValOpsFS.host` and
    // `.jsonEntryFilesFingerprint`, `ValOpsHttp.authHeaders` and `.root`,
    // `SessionImageToPatchError.availableKeys`. Every one is assigned in its
    // own constructor body, which runs after the field initializers, and
    // `ValOps` assigns none of them. So nothing changes behaviour today; a base
    // class that starts assigning a name its subclass declares would.
    ["@babel/preset-typescript", { allowDeclareFields: true }],
  ],
  babelrcRoots: [".", "./packages/*"],
};
