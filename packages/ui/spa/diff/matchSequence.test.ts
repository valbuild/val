import {
  longestIncreasing,
  matchSequence,
  MATCH_MAX_ITEMS,
  type SequenceMatch,
} from "./matchSequence";

type Item = { id: string; text: string };

/** Items written as `id:text`, so a test reads as two lists. */
function items(...specs: string[]): Item[] {
  return specs.map((spec) => {
    const [id, text = ""] = spec.split(":");
    return { id, text };
  });
}

/**
 * One line per match, in the order they are reported:
 * `=a` kept, `~a` edited, `>a` moved, `>~a` moved and edited, `+a`, `-a`.
 */
function read(before: Item[], after: Item[], matches: SequenceMatch[]): string {
  return matches
    .map((match) => {
      if (match.kind === "added") return `+${after[match.after].id}`;
      if (match.kind === "removed") return `-${before[match.before].id}`;
      return `${match.moved ? ">" : ""}${match.equal ? "" : "~"}${
        match.moved || !match.equal ? "" : "="
      }${after[match.after].id}`;
    })
    .join(" ");
}

/** Items are the same item when most of their text is. */
const byIdAndText = {
  keyOf: (item: Item) => `${item.id}:${item.text}`,
  similarity: (a: Item, b: Item) => (a.id === b.id ? 1 : 0),
};

function diff(
  before: Item[],
  after: Item[],
  options: Parameters<typeof matchSequence<Item>>[2] = byIdAndText,
): string {
  return read(before, after, matchSequence(before, after, options).matches);
}

describe("matchSequence", () => {
  test("nothing changed is every item kept", () => {
    const list = items("a", "b", "c");
    expect(diff(list, list)).toBe("=a =b =c");
  });

  /**
   * The case comparing by index gets wrong: every item after the insertion
   * has a new index, and none of them changed.
   */
  test("an insertion is one addition, and nothing after it changed", () => {
    expect(diff(items("a", "b", "c"), items("a", "x", "b", "c"))).toBe(
      "=a +x =b =c",
    );
  });

  test("a removal is reported where the item used to be", () => {
    expect(diff(items("a", "b", "c", "d"), items("a", "c", "d"))).toBe(
      "=a -b =c =d",
    );
  });

  /** Every index shifted, and one item moved. */
  test("moving the last item first moves one item", () => {
    expect(diff(items("a", "b", "c", "d"), items("d", "a", "b", "c"))).toBe(
      ">d =a =b =c",
    );
  });

  test("moving the first item last moves one item", () => {
    expect(diff(items("a", "b", "c", "d"), items("b", "c", "d", "a"))).toBe(
      "=b =c =d >a",
    );
  });

  test("an item edited where it is, is that item and did not move", () => {
    expect(
      diff(
        items("a:one", "b:two", "c:three"),
        items("a:one", "b:2", "c:three"),
      ),
    ).toBe("=a ~b =c");
  });

  test("an item can move and be edited", () => {
    expect(
      diff(
        items("a:one", "b:two", "c:three", "d:four"),
        items("d:4", "a:one", "b:two", "c:three"),
      ),
    ).toBe(">~d =a =b =c");
  });

  test("everything at once", () => {
    expect(
      diff(
        items(
          "hero",
          "faq:weekly",
          "footer",
          "logos",
          "features",
          "pricing",
          "news",
        ),
        items(
          "hero",
          "pricing",
          "quotes",
          "faq:daily",
          "logos",
          "features",
          "footer",
        ),
      ),
    ).toBe("=hero >pricing +quotes ~faq =logos =features >footer -news");
  });

  test("equal items pair one for one", () => {
    const sameText = { keyOf: (item: Item) => item.id };
    // Two of the three kept their order whichever `a` is called the mover.
    const swapped = diff(items("a", "a", "b"), items("a", "b", "a"), sameText);
    expect(
      swapped.split(" ").filter((each) => each.startsWith(">")),
    ).toHaveLength(1);
    expect(swapped).not.toMatch(/[+-]/);
    expect(diff(items("a", "a"), items("a"), sameText)).toBe("=a -a");
  });

  describe("an item rewritten where it stood", () => {
    const rewritable = {
      keyOf: (item: Item) => `${item.id}:${item.text}`,
      comparable: () => true,
    };

    test("is one item, changed", () => {
      expect(diff(items("a", "b", "c"), items("a", "x", "c"), rewritable)).toBe(
        "=a ~x =c",
      );
    });

    /**
     * Two went and one came: which of the two became it is not something the
     * two lists say, so nothing is claimed.
     */
    test("is not guessed at when the counts differ", () => {
      expect(
        diff(items("a", "b", "c", "d"), items("a", "x", "d"), rewritable),
      ).toBe("=a +x -b -c =d");
    });

    test("is not paired across an item that stayed", () => {
      expect(
        diff(items("a", "b", "c"), items("x", "b", "c", "y"), rewritable),
      ).toBe("~x =b =c +y");
    });

    test("needs the two to be of a kind", () => {
      expect(
        diff(items("a", "b", "c"), items("a", "x", "c"), {
          ...rewritable,
          comparable: () => false,
        }),
      ).toBe("=a +x -b =c");
    });
  });

  /** The best match wins, not the first to clear the bar. */
  test("an item pairs with the one it is most like", () => {
    const before = items("a:red green blue", "b:red green");
    const after = items("x:red green pink", "y:red green blue cyan");
    const overlap = {
      keyOf: (item: Item) => item.text,
      similarity: (a: Item, b: Item) => {
        const left = a.text.split(" ");
        const right = b.text.split(" ");
        const shared = left.filter((word) => right.includes(word)).length;
        return shared / Math.max(left.length, right.length);
      },
    };
    const { matches } = matchSequence(before, after, overlap);
    const pairs = matches.flatMap((match) =>
      match.kind === "kept"
        ? [`${before[match.before].id}>${after[match.after].id}`]
        : [],
    );
    expect(pairs.sort()).toEqual(["a>y", "b>x"]);
  });

  test("lists too long to match by content are compared by position", () => {
    const long = Array.from({ length: MATCH_MAX_ITEMS + 1 }, (_, index) => ({
      id: String(index),
      text: "",
    }));
    const result = matchSequence(long, [...long.slice(1), long[0]], {
      keyOf: (item: Item) => item.id,
    });
    expect(result.positional).toBe(true);
    expect(result.matches.every((match) => match.kind === "kept")).toBe(true);
  });
});

describe("longestIncreasing", () => {
  test("gives the positions of a longest increasing run", () => {
    expect(longestIncreasing([])).toEqual([]);
    expect(longestIncreasing([3, 0, 1, 2])).toEqual([1, 2, 3]);
    expect(longestIncreasing([0, 4, 1, 3, 6, 2])).toEqual([0, 2, 3, 4]);
    expect(longestIncreasing([2, 1, 0])).toHaveLength(1);
  });
});
