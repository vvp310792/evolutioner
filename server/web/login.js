'use strict';
document.getElementById('login').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});
    const result=await response.json();if(!response.ok)throw Error(result.error);
    location.replace('/');
  }catch(error){document.getElementById('error').textContent=error.message;}finally{button.disabled=false;}
});
