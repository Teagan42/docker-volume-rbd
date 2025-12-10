import util from 'util';
import child_process from "child_process";
import typia from 'typia';
const execFile = util.promisify(child_process.execFile);
import { mkdir, rmdir } from "fs/promises";
import { log } from 'console';

type RBDOptions = {
    pool: string,
    cluster: string,
    user: string,
    map_options: string[],
    order: string,
    rbd_options: string
};

interface RBDMapEntry {
    id: string,
    pool: string,
    namespace: string,
    name: string,
    snap: string,
    device: string
}

interface RBDListEntry {
    image: string,
    id: string,
    size: number,
    format: number,
}

const rbdShowMapped = typia.createValidate<RBDMapEntry[]>();
const rbdList = typia.createValidate<RBDListEntry[]>();

export default class Rbd {
    // ToDo: Actually used the passed in options for cluster and user
    constructor(readonly options: RBDOptions) { }

    async isMapped(name: string): Promise<string | null> {    
        try {
            const { stdout, stderr } = await execFile(
                "rbd", [
                    "showmapped",
                    "--format",
                    "json"
                ], { timeout: 30000 }
            );
            if (stderr) console.log(stderr);

            const mappedResult = rbdShowMapped(stdout);

            if (!mappedResult.success){
                throw new Error(`rbd showmapped output validation failed: ${JSON.stringify(mappedResult.errors)}`);
            }

            const entry = mappedResult.data.find(i => i.pool === this.options.pool && i.name === name);

            if (!entry) {
                return null;
            }

            return entry.device;
        }
        catch (error) {
            console.error(error);
            if (error instanceof Error) {
                throw new Error(`rbd showmapped command failed: ${error.message}`);
            } else {
                throw new Error(`rbd showmapped command failed with an unknown error: ${String(error)}`);
            }
        }
    }
    
    async map(name: string): Promise<string> {
        try {
            let mappedDevice = await this.isMapped(name);
                
            if (mappedDevice) {
                return mappedDevice;
            }
        } catch {}

        try {
            const { stdout, stderr } = await execFile(
                "rbd", [
                    "map",
                    ...this.options.map_options,
                    "--pool", 
                    this.options.pool,
                    name
                ], { timeout: 30000 }
            );
            if (stderr) console.log(stderr);
    
            return (stdout as string).trim();
        }
        catch (error) {
            console.error(error);
            if (error instanceof Error) {
                // 'code' may not exist on Error, so use (error as any).code
                throw new Error(`rbd map command failed with code ${(error as any).code}: ${error.message}`);
            } else {
                throw new Error(`rbd map command failed with an unknown error: ${String(error)}`);
            }
        }
    }
    
    async unMap(name: string): Promise<void> {
        try {
            let mappedDevice = await this.isMapped(name);
                
            if (!mappedDevice) {
                return;
            }
        } catch {}

        try {
            const { stdout, stderr } = await execFile(
                "rbd", [
                    "unmap",
                    "--pool",
                    this.options.pool,
                    name
                ], { timeout: 30000 }
            );
            if (stderr) console.log(stderr);
            if (stdout) console.log(stdout);

            for(var i = 0; i < 5; i++) {
                if (!(await this.isMapped(name))) {
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        catch (error) {
            console.error(error);
            if (error instanceof Error) {
                throw new Error(`rbd unmap command failed with code ${(error as any).code}: ${error.message}`);
            } else {
                throw new Error(`rbd unmap command failed with an unknown error: ${String(error)}`);
            }
        }
    }

    async list(): Promise<RBDListEntry[]> {
        try {
            const { stdout, stderr } = await execFile(
                "rbd", [
                    "list",
                    "--pool",
                    this.options.pool,
                    "--long",
                    "--format",
                    "json"
                ], { timeout: 30000 }
            );
            if (stderr) console.log(stderr);
            const listResult = rbdList(stdout);
            
            if (!listResult.success){
                throw new Error(`rbd list output validation failed: ${JSON.stringify(listResult.errors)}`);
            }

            return listResult.data;
        }
        catch (error) {
            console.error(error);
            if (error instanceof Error) {
                throw new Error(`rbd list command failed with code ${(error as any).code}: ${error.message}`);
            } else {
                throw new Error(`rbd list command failed with an unknown error: ${String(error)}`);
            }
        }
    }
    
    async getInfo(name: string): Promise<RBDListEntry | undefined> {
        let rbdList = await this.list();
    
        return rbdList.find(i => i.image === name);
    }

    async create(name: string, size: string ): Promise<boolean> {
        try {
            const extraRbdArgs = this.options.rbd_options? [
                "--image-feature", 
                this.options.rbd_options
            ] : []
            const { stdout, stderr } = await execFile(
                "rbd", [
                    "create",
                    "--order",
                    this.options.order,
                    "--pool",
                    this.options.pool,
                    "--size",
                    size,
                    ...extraRbdArgs,
                    name
                ], { timeout: 30000 }
            );
            if (stderr) console.log(stderr);
            if (stdout) console.log(stdout);
            return true;
        }
        catch (error) {
            console.error(error);
            if (error instanceof Error) {
                throw new Error(`rbd create command failed with code ${(error as any).code}: ${error.message}`);
            } else {
                throw new Error(`rbd create command failed with an unknown error: ${String(error)}`);
            }
        }
    }

    async makeFilesystem(fstype: string, device: string, mkfs_options: string ) {
        try {
            const extraArgs = mkfs_options? ["fs-options", ...mkfs_options.split(' ')] : []
            const { stdout, stderr } = await execFile(
                "mkfs", [
                    "-t",
                    fstype,
                    ...extraArgs,
                    device
                ], { timeout: 120000 }
            );
            if (stderr) console.error(stderr);
            if (stdout) console.log(stdout);
        }
        catch (error) {
            console.error(error);
            if (error instanceof Error) {
                throw new Error(`mkfs -t ${fstype} ${device} command failed with code ${(error as any).code}: ${error.message}`);
            } else {
                throw new Error(`mkfs -t ${fstype} ${device} command failed with an unknown error: ${String(error)}`);
            }
        }
    }

    async remove(name: string): Promise<void> {
        try {
            const { stdout, stderr } = await execFile(
                "rbd", [
                    "trash",
                    "move",
                    "--pool",
                    this.options.pool,
                    name
                ], { timeout: 30000 }
            );
            if (stderr) console.log(stderr);
            if (stdout) console.log(stdout);
        }
        catch (error) {
            console.error(error);
            if (error instanceof Error) {
                throw new Error(`rbd remove command failed with code ${(error as any).code}: ${error.message}`);
            } else {
                throw new Error(`rbd remove command failed with an unknown error: ${String(error)}`);
            }
        }
    }

    async isMounted(device: string): Promise<boolean> {
        try {
            const { stdout } = await execFile("mount", { timeout: 30000 });
            const lines = stdout.split(/\r?\n/).filter(l => l.includes(device));
            return lines.length > 0;
        } catch(error) {
            console.error(error);
            if (error instanceof Error) {
                throw new Error(`list mount command failed with code ${(error as any).code}: ${error.message}`);
            } else {
                throw new Error(`list mount command failed with an unknown error: ${String(error)}`);
            }
        }
    }

    async mount(device: string, mountPoint: string): Promise<void> {
        await mkdir(mountPoint, { recursive: true });
        try {
            await this.unmount(mountPoint, false);
        } catch {}

        try {
            const { stdout, stderr } = await execFile(
                "mount", [
                    device,
                    mountPoint
                ], { timeout: 30000 }
            );
            if (stderr) console.error(stderr);
            if (stdout) console.log(stdout);
        }
        catch (error) {
            console.error(error);
            if (error instanceof Error) {
                throw new Error(`mount command failed with code ${(error as any).code}: ${error.message}`);
            } else {
                throw new Error(`mount command failed with an unknown error: ${String(error)}`);
            }
        }
    }

    async unmount(mountPoint: string, logException: boolean=true): Promise<void> {
        try {
            const { stdout, stderr } = await execFile(
                "umount", [
                    mountPoint
                ], { timeout: 30000 }
            );
            if (stderr) console.error(stderr);
            if (stdout) console.log(stdout);
            for(var i = 0; i < 5; i++) {
                if (!(await this.isMounted(mountPoint))) {
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        catch (error) {
            if (logException) {
                console.error(error);
            }
            if (error instanceof Error) {
                throw new Error(`umount command failed with code ${(error as any).code}: ${error.message}`);
            } else {
                throw new Error(`umount command failed with an unknown error: ${String(error)}`);
            }
        }

        await rmdir(mountPoint);
    }
}