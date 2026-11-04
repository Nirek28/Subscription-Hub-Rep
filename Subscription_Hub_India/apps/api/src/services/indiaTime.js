// Calendar-day boundaries for India (UTC+05:30, no daylight saving time).
export const indiaDay = value => new Date(new Date(new Date(value).getTime()+19800000).toISOString().slice(0,10)+'T00:00:00Z');
export function indiaMonthBounds(now=new Date()){
 const shifted=new Date(now.getTime()+19800000);
 return [Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),1)-19800000,Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth()+1,1)-19800000];
}
