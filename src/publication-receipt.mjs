// A disabled or incomplete platform UI is not a publication receipt.
export async function waitPublicationReceipt(page,{channel,title,timeout=90000}={}){
 await page.getByText(/发表成功|发布成功/).filter({visible:true}).first().waitFor({state:'visible',timeout});
 return {confirmed:true,channel,title,url:page.url(),at:new Date().toISOString(),state:'submitted',message:'平台显示'+(channel==='wechat'?'发表成功':'发布成功')+'；公开状态以平台审核为准'};
}
