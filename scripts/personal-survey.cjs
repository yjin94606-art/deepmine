'use strict';

function personalSurveyRoute({projectId,history}){
  return async function handle(request,response,headers){
    const json={...headers,'Content-Type':'application/json'};
    if(request.method!=='GET'){
      response.writeHead(405,{...json,Allow:'GET'});
      response.end(JSON.stringify({error:'method'}));
      return;
    }
    try{
      const {day,meters,stamps}=await history.getSurvey();
      response.writeHead(200,json);
      response.end(JSON.stringify({projectId,day,meters,stamps}));
    }catch{
      response.writeHead(503,json);
      response.end(JSON.stringify({error:'local_unavailable'}));
    }
  };
}
module.exports={personalSurveyRoute};
