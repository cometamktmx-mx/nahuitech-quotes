export type EntryMembership = {
 organization_id: string;
 network_role: string;
 organizations: {name:string;slug:string;organization_type:string;status:string} | {name:string;slug:string;organization_type:string;status:string}[];
};
export function networkEntry(members: EntryMembership[]) {
 if(!members.length) return "activate";
 if(members.length>1) return "select";
 return "enter";
}
export function networkDestination(member: EntryMembership) {
 const org=Array.isArray(member.organizations)?member.organizations[0]:member.organizations;
 return org?.organization_type==="MANUFACTURER" && ["NETWORK_OWNER","ORG_ADMIN"].includes(member.network_role) ? "/network/hq" : "/network";
}
