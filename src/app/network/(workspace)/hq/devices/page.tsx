import { requireNetwork } from "@/lib/network/server";
import { DeviceList } from "@/components/network/devices";
export default async function Devices(){const {db}=await requireNetwork(true);const {data,error}=await db.rpc("network_device_directory",{p_org:null});if(error)throw new Error(error.message);return <><h1>Dispositivos de la red</h1><DeviceList devices={data??[]}/></>}
