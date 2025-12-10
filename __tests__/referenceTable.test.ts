import ReferenceTable from "../src/referenceTable";

describe("ReferenceTable", () => {
    test("adds and counts unique IDs", () => {
        const table = new ReferenceTable();

        expect(table.add("vol1", "id-a")).toBe(1);
        expect(table.add("vol1", "id-b")).toBe(2);
        expect(table.add("vol1", "id-a")).toBe(2); // duplicate ignored
        expect(table.count("vol1")).toBe(2);
    });

    test("remove returns remaining count and avoids negative", () => {
        const table = new ReferenceTable();
        table.add("vol1", "id-a");
        table.add("vol1", "id-b");

        const firstRemoval = table.remove("vol1", "id-a");
        expect(firstRemoval).toEqual({ remaining: 1, removed: true });
        expect(table.count("vol1")).toBe(1);

        const secondRemoval = table.remove("vol1", "id-b");
        expect(secondRemoval).toEqual({ remaining: 0, removed: true });
        expect(table.count("vol1")).toBe(0);

        const unknown = table.remove("vol1", "id-c");
        expect(unknown).toEqual({ remaining: 0, removed: false });
    });

    test("remove on unknown volume is a no-op", () => {
        const table = new ReferenceTable();
        expect(table.remove("missing", "id-x")).toEqual({ remaining: 0, removed: false });
    });
});
