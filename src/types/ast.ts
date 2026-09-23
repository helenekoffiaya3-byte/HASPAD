import { z } from "zod";
const CssValue=z.string().max(500).refine(v=>!/[<>]/.test(v)&&!/javascript\s*:/i.test(v)&&!/@import/i.test(v),"Valeur CSS non autorisée");
export const BlockTypeSchema=z.enum(["section","container","heading","text","image","button","link","grid","flex","video","form","input","textarea","spacer","divider","payment_button"]);
const StyleSchema=z.record(CssValue);
const EventSchema=z.discriminatedUnion("action",[
z.object({trigger:z.literal("onClick"),action:z.literal("navigate"),payload:z.object({url:z.string().refine(v=>v.startsWith("/")||/^https:\/\//i.test(v),"URL non autorisée")})}),
z.object({trigger:z.literal("onClick"),action:z.literal("open_modal"),payload:z.object({modalId:z.string().regex(/^[a-zA-Z0-9_-]+$/)})}),
z.object({trigger:z.literal("onSubmit"),action:z.literal("submit_form"),payload:z.object({endpoint:z.string().regex(/^\/api\/v1\/forms\/[a-zA-Z0-9_-]+$/)})})
]);
export type BlockNode={id:string;type:z.infer<typeof BlockTypeSchema>;label?:string;props:Record<string,unknown>;styles?:{desktop?:Record<string,string>;tablet?:Record<string,string>;mobile?:Record<string,string>;hover?:Record<string,string>};events?:z.infer<typeof EventSchema>[];children?:BlockNode[]};
export const BlockNodeSchema:z.ZodType<BlockNode>=z.lazy(()=>z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),type:BlockTypeSchema,label:z.string().max(100).optional(),props:z.record(z.unknown()).default({}),styles:z.object({desktop:StyleSchema.optional(),tablet:StyleSchema.optional(),mobile:StyleSchema.optional(),hover:StyleSchema.optional()}).optional(),events:z.array(EventSchema).max(10).optional(),children:z.array(BlockNodeSchema).max(200).optional()}));