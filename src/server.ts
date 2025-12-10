import express from "express";
import process from "process";

import Rbd from "./rbd";
const socketAddress = "/run/docker/plugins/rbd.sock";
const pool = process.env.RBD_CONF_POOL || "rbd";
const cluster = process.env.RBD_CONF_CLUSTER || "ceph"; // ToDo: Not utilized currently
const user = process.env.RBD_CONF_KEYRING_USER || "swarm"; // ToDo: Not utilized currently
const order = process.env.RBD_CONF_ORDER || "22"
const rbd_options = process.env.RBD_CONF_RBD_OPTIONS || "layering,exclusive-lock,object-map,fast-diff,deep-flatten";
const map_options = process.env.RBD_CONF_MAP_OPTIONS ? process.env.RBD_CONF_MAP_OPTIONS.split(';') : ["--exclusive"]; // default to an exclusive lock when mapping to prevent multiple containers attempting to mount the block device
const rbd = new Rbd({ pool: pool, cluster: cluster, user: user, map_options: map_options, order: order, rbd_options: rbd_options});

const app = express();
app.use(express.json({ strict: false, type: req => true }));

// Documentation about docker volume plugins can be found here: https://docs.docker.com/engine/extend/plugins_volume/

app.post("/Plugin.Activate", (request, response) => {
    console.log("Activating rbd volume driver");

    response.json({
        "Implements": ["VolumeDriver"]
    });
});

function getMountPoint(name: string): string {
    return `/mnt/volumes/${pool}/${name}`;
}

/*
    Instruct the plugin that the user wants to create a volume, given a user specified volume name. 
    The plugin does not need to actually manifest the volume on the filesystem yet (until Mount is 
    called). Opts is a map of driver specific options passed through from the user request.
*/
app.post("/VolumeDriver.Create", async (request, response) => {
    const req = request.body as { Name: string, Opts: { size: string, fstype: string, mkfs_options: string } };
    const fstype = req.Opts?.fstype || "xfs";
    const size = req.Opts?.size || "200M";
    const mkfs_options = req.Opts?.mkfs_options || "";

    console.log(`Creating rbd volume ${req.Name}`);

    try {
        if (await rbd.create(req.Name, size)) {
            let device = await rbd.map(req.Name);
            await rbd.makeFilesystem(fstype, device, mkfs_options);
            await rbd.unMap(req.Name);
        }
    }
    catch (error) {
        const errMsg = (error instanceof Error) ? error.message : String(error);
        return response.json({ Err: errMsg });
    }

    response.json({
        Err: ""
    });
});


/*
    Delete the specified volume from disk. This request is issued when a user invokes 
    docker rm -v to remove volumes associated with a container.
*/
app.post("/VolumeDriver.Remove", async (request, response) => {
    const req = request.body as { Name: string };

    console.log(`Removing rbd volume ${req.Name}`);

    try {
        const mountPoint = getMountPoint(req.Name);
        if (await rbd.isMounted(mountPoint)) {
            await rbd.unmount(mountPoint);
        }
        await rbd.unMap(req.Name);
        await rbd.remove(req.Name);
    }
    catch (error) {
        const errMsg = (error instanceof Error) ? error.message : String(error);
        return response.json({ Err: errMsg });
    }

    response.json({
        Err: ""
    });
});

/*
    Docker requires the plugin to provide a volume, given a user specified volume name. 
    Mount is called once per container start. If the same volume_name is requested more 
    than once, the plugin may need to keep track of each new mount request and provision 
    at the first mount request and deprovision at the last corresponding unmount request.
*/
app.post("/VolumeDriver.Mount", async (request, response) => {
    const req = request.body as { Name: string, ID: string };
    const mountPoint = getMountPoint(req.Name);

    console.log(`Mounting rbd volume ${req.Name}`);

    if (await rbd.isMounted(mountPoint)) {
        console.log(`${mountPoint} is already mounted`);
        return response.json({
            MountPoint: mountPoint,
            Err: ""
        });
    }

    try {
        let device = await rbd.isMapped(req.Name);

        if (!device) {
            device = await rbd.map(req.Name);
        }

        if (!await rbd.isMounted(mountPoint)) {
            await rbd.mount(device, mountPoint);
        }
    }
    catch (error) {
        const errMsg = (error instanceof Error) ? error.message : String(error);
        return response.json({ Err: errMsg });
    }
    
    response.json({
        MountPoint: mountPoint,
        Err: ""
    });
});

/*
    Request the path to the volume with the given volume_name.
*/
app.post("/VolumeDriver.Path", async (request, response) => {
    const req = request.body as { Name: string };
    const mountPoint = getMountPoint(req.Name);

    console.log(`Request path of rbd mount ${req.Name}`);
    if (await rbd.isMounted(mountPoint)) {
        return response.json({
            MountPoint: mountPoint,
            Err: ""
        });
    }
    response.json({ Err: `Volume ${req.Name} is not mounted` });
});

/*
    Docker is no longer using the named volume. Unmount is called once per container stop. 
    Plugin may deduce that it is safe to deprovision the volume at this point.

    ID is a unique ID for the caller that is requesting the mount.
*/
app.post("/VolumeDriver.Unmount", async (request, response) => {
    const req = request.body as { Name: string, ID: string };
    const mountPoint = getMountPoint(req.Name);

    console.log(`Unmounting rbd volume ${req.Name}`);
    if (await rbd.isMounted(mountPoint)) {
        try {
            await rbd.unmount(mountPoint);
        }
        catch (error) {
            const errMsg = (error instanceof Error) ? error.message : String(error);
            return response.json({ Err: errMsg });
        }
    }
    if (await rbd.isMapped(req.Name)) {
        try {
            await rbd.unMap(req.Name);
        }
        catch (error) {
            const errMsg = (error instanceof Error) ? error.message : String(error);
            return response.json({ Err: errMsg });
        }
    }

    response.json({
        Err: ""
    });
});

/*
    Get info about volume_name.
*/
app.post("/VolumeDriver.Get", async (request, response) => {
    const req = request.body as { Name: string };
    const mountPoint = getMountPoint(req.Name);

    console.log(`Getting info about rbd volume ${req.Name}`);

    try {
        const info = await rbd.getInfo(req.Name);

        if (!info) {
            return response.json({ Err: "" });
        }

        response.json({
            Volume: {
                Name: req.Name,
                Mountpoint: mountPoint,
                Status: {
                    size: info.size
                }
            },
            Err: ""
        });
    } catch (error) {
        const errMsg = (error instanceof Error) ? error.message : String(error);
        return response.json({ Err: errMsg });
    }
});

/*
    Get the list of volumes registered with the plugin.
*/
app.post("/VolumeDriver.List", async (request, response) => {
    console.log("Getting list of registered rbd volumes");

    try {
        const rbdList = await rbd.list();

        response.json({
            Volumes: rbdList.map(info => {
                return {
                    Name: info.image,
                };
            }),
            Err: ""
        });
    }
    catch (error) {
        const errMsg = (error instanceof Error) ? error.message : String(error);
        return response.json({ Err: errMsg });
    }
});

app.post("/VolumeDriver.Capabilities", (request, response) => {
    console.log("Getting the list of capabilities");

    response.json({
        Capabilities: {
            Scope: "global"
        }
    });
});


app.listen(socketAddress, () => {
    console.log(`Plugin rbd listening on socket ${socketAddress}`);
});
