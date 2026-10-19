import { requireNetwork } from "@/lib/network/server";
import { refreshSalesNetworkTasks } from "@/lib/network/tasks";
import { TaskList } from "@/components/network/tasks";
import { ActionForm } from "@/components/network/action-form";
import { taskAction } from "../../actions";
export default async function Tasks(){const {db,org}=await requireNetwork();await refreshSalesNetworkTasks(db,org);const {data,error}=await db.from("sales_tasks").select("*").eq("organization_id",org).in("status",["OPEN","IN_PROGRESS"]).order("priority_rank").order("due_at").limit(100);if(error)throw new Error(error.message);return <><h1>Tu seguimiento</h1><details className="net-card"><summary>+ Nueva tarea</summary><ActionForm action={taskAction} className="mt-5" label="Crear tarea"><label>Título<input name="title" required maxLength={200}/></label><label>Descripción<textarea name="description" maxLength={4000}/></label><label>Fecha<input name="due_at" type="datetime-local" required/></label><label>Prioridad<select name="priority">{["LOW","MEDIUM","HIGH","URGENT"].map(p=><option key={p}>{p}</option>)}</select></label></ActionForm></details><TaskList tasks={data??[]}/></>}
