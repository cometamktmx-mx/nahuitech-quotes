import type {QuotePdfSnapshot} from '@/lib/pdf/quote-pdf-types';
export function quoteBranding(q:{organization_branding_snapshot?:{type?:string;name?:string;logo_url?:string|null;label?:string|null;footer?:string|null}|null;salesperson_phone_snapshot?:string|null;salesperson_email_snapshot?:string|null}):QuotePdfSnapshot['dealerBranding']{
 const b=q.organization_branding_snapshot;if(b?.type!=='DEALER'||!b.name)return undefined;
 return {name:b.name,logoUrl:b.logo_url??null,label:b.label??'Distribuidor',footer:b.footer??null,sellerPhone:q.salesperson_phone_snapshot??null,sellerEmail:q.salesperson_email_snapshot??null};
}
