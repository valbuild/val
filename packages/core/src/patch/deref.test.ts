import { file } from "../source/file";
import { result } from "../fp";
import { remote } from "../source/future/remote";
import { derefPatch, DerefPatchResult } from "./deref";
import { JSONOps } from "./json";
import { PatchError } from "./ops";

const ops = new JSONOps();
describe("deref", () => {
  test("replace image", () => {
    const actual = derefPatch(
      [
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 2,
        },
        {
          op: "replace",
          path: ["foo", "$image1"],
          value: "aWtrZSB25nJzdD8=",
        },
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 3,
        },
        {
          op: "replace",
          path: ["foo", "$image2"],
          value: "ZnVua2VyIGRldHRlPw==",
        },
      ],
      {
        foo: {
          baz: 1,
          image1: file("/public/val/File\\ Name.jpg", {}),
          image2: file("/public/val/Some\\ Other\\ image.jpg", {}),
        },
      },
      ops
    );
    const expected: DerefPatchResult = {
      dereferencedPatch: [
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 2,
        },
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 3,
        },
      ],
      fileUpdates: {
        "/public/val/File\\ Name.jpg": "aWtrZSB25nJzdD8=",
        "/public/val/Some\\ Other\\ image.jpg": "ZnVua2VyIGRldHRlPw==",
      },
    };
    expect(actual).toStrictEqual(result.ok(expected));
  });

  test("replace image sub-reference fails", () => {
    const actual = derefPatch(
      [
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 2,
        },
        {
          op: "replace",
          path: ["foo", "$image1", "bar"],
          value: "aWtrZSB25nJzdD8=",
        },
      ],
      {
        foo: {
          baz: 1,
          image1: file("/public/val/File\\ Name.jpg", {}),
        },
      },
      ops
    );
    expect(actual).toStrictEqual(result.err(expect.any(PatchError)));
  });

  test("replace image with 2 replaces on same image", () => {
    const actual = derefPatch(
      [
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 2,
        },
        {
          op: "replace",
          path: ["foo", "$image1"],
          value: "aWtrZSB25nJzdD8=",
        },
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 3,
        },
        {
          op: "replace",
          path: ["foo", "$image2"],
          value: "ZnVua2VyIGRldHRlPw==",
        },
      ],
      {
        foo: {
          baz: 1,
          image1: file("/public/val/File\\ Name.jpg", {}),
          image2: file("/public/val/File\\ Name.jpg", {}),
        },
      },
      ops
    );
    const expected: DerefPatchResult = {
      dereferencedPatch: [
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 2,
        },
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 3,
        },
      ],
      fileUpdates: {
        "/public/val/File\\ Name.jpg": "ZnVua2VyIGRldHRlPw==",
      },
    };
    expect(actual).toStrictEqual(result.ok(expected));
  });

  // test("replace remote", () => {
  //   const actual = derefPatch(
  //     [
  //       {
  //         op: "replace",
  //         path: ["foo", "baz"],
  //         value: 2,
  //       },
  //       {
  //         op: "replace",
  //         path: ["foo", "$re1", "test1"],
  //         value: "next test1 update",
  //       },
  //       {
  //         op: "replace",
  //         path: ["foo", "baz"],
  //         value: 3,
  //       },
  //       {
  //         op: "replace",
  //         path: ["foo", "$re2", "test2", "sub-segment"],
  //         value: "next test2 update",
  //       },
  //     ],
  //     {
  //       foo: {
  //         baz: 1,
  //         re1: remote("41f86df3"),
  //         re2: remote("96536d44"),
  //       },
  //     },
  //     ops
  //   );
  //   const expected: DerefPatchResult = {
  //     dereferencedPatch: [
  //       {
  //         op: "replace",
  //         path: ["foo", "baz"],
  //         value: 2,
  //       },
  //       {
  //         op: "replace",
  //         path: ["foo", "baz"],
  //         value: 3,
  //       },
  //     ],
  //     fileUpdates: {},
  //     remotePatches: {
  //       "41f86df3": [
  //         {
  //           op: "replace",
  //           path: ["test1"],
  //           value: "next test1 update",
  //         },
  //       ],
  //       "96536d44": [
  //         {
  //           op: "replace",
  //           path: ["test2", "sub-segment"],
  //           value: "next test2 update",
  //         },
  //       ],
  //     },
  //   };
  //   expect(actual).toStrictEqual(result.ok(expected));
  // });
  // test("replace remote with 2 replaces on same ref", () => {
  //   const actual = derefPatch(
  //     [
  //       {
  //         op: "replace",
  //         path: ["foo", "baz"],
  //         value: 2,
  //       },
  //       {
  //         op: "replace",
  //         path: ["foo", "$re1", "test1"],
  //         value: "next test1 update",
  //       },
  //       {
  //         op: "replace",
  //         path: ["foo", "baz"],
  //         value: 3,
  //       },
  //       {
  //         op: "replace",
  //         path: ["foo", "$re1", "test1"],
  //         value: "next test2 update",
  //       },
  //     ],
  //     {
  //       foo: {
  //         baz: 1,
  //         re1: remote("41f86df3"),
  //         re2: remote("96536d44"),
  //       },
  //     },
  //     ops
  //   );
  //   const expected: DerefPatchResult = {
  //     dereferencedPatch: [
  //       {
  //         op: "replace",
  //         path: ["foo", "baz"],
  //         value: 2,
  //       },
  //       {
  //         op: "replace",
  //         path: ["foo", "baz"],
  //         value: 3,
  //       },
  //     ],
  //     fileUpdates: {},
  //     remotePatches: {
  //       "41f86df3": [
  //         {
  //           op: "replace",
  //           path: ["test1"],
  //           value: "next test1 update",
  //         },
  //         {
  //           op: "replace",
  //           path: ["test1"],
  //           value: "next test2 update",
  //         },
  //       ],
  //     },
  //   };
  //   expect(actual).toStrictEqual(result.ok(expected));
  // });

  test("replace chained references fails", () => {
    const actual = derefPatch(
      [
        {
          op: "replace",
          path: ["foo", "baz"],
          value: 2,
        },
        {
          op: "replace",
          path: ["foo", "$re1", "$re2"], // we do not support this, but it might be something we need in the future depending on how remote values
          value: "next test1 update",
        },
      ],
      {
        foo: {
          baz: 1,
          re1: remote("41f86df3"),
          re2: remote("96536d44"),
        },
      },
      ops
    );
    expect(actual).toStrictEqual(result.err(expect.any(PatchError)));
  });
});
