import { redirect } from "next/navigation";
import { requireNetwork } from "@/lib/network/server";
import { DeviceList } from "@/components/network/devices";
export default async function Devices(){const {db,org}=await requireNetwork();const {data:allowed}=await db.rpc("can_manage_org",{p_org:org});if(!allowed)redirect("/network");const {data,error}=await db.rpc("network_device_directory",{p_org:org});if(error)throw new Error(error.message);return <><h1>Dispositivos de la organización</h1><DeviceList devices={data??[]}/></>}
