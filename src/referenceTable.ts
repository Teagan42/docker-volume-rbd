export type ReferenceRemoval = {
    remaining: number;
    removed: boolean;
};

/**
 * Tracks mount references per volume so we only tear down once the last
 * caller has released the volume.
 */
export default class ReferenceTable {
    private refs = new Map<string, Set<string>>();

    add(name: string, id: string): number {
        const set = this.refs.get(name) ?? new Set<string>();
        set.add(id);
        this.refs.set(name, set);
        return set.size;
    }

    remove(name: string, id: string): ReferenceRemoval {
        const set = this.refs.get(name);

        if (!set) {
            return { remaining: 0, removed: false };
        }

        const removed = set.delete(id);

        if (set.size === 0) {
            this.refs.delete(name);
        }

        return { remaining: set.size, removed };
    }

    count(name: string): number {
        return this.refs.get(name)?.size ?? 0;
    }
}
