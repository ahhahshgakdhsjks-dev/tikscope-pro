export function mock(platform, q, limit){
  const names=['Serum Niacinamide Viral','Sunscreen Tone Up SPF50','Kemeja Linen Oversize','TWS Bluetooth 5.3','Vacuum Mini Portable','Basreng Daun Jeruk'];
  return Array.from({length:limit},(_,i)=>({title:(q?q+' ':'')+names[i%names.length]+' #'+(i+1),price:20000+Math.floor(Math.random()*200000),sold:500+Math.floor(Math.random()*50000),shop:'Shop-'+(i+1),category:'Beauty'}));
}
