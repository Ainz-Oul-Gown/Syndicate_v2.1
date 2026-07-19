-- Run before/after 202607190002_integrity_and_rls.sql.
-- Every result set should ideally be empty.

select 'debts_missing_creditor' as issue, d.* from public.debts d
left join public.users u on u.tg_id=d.creditor_id where u.id is null;
select 'debts_missing_debtor' as issue, d.* from public.debts d
left join public.users u on u.tg_id=d.debtor_id where u.id is null;
select 'currencies_missing_owner' as issue, c.* from public.currencies c
left join public.users u on u.tg_id=c.owner_id where u.id is null;
select 'device_requests_missing_owner' as issue, r.* from public.device_requests r
left join public.users u on u.tg_id=r.user_id where u.id is null;
select 'user_devices_missing_owner' as issue, d.* from public.user_devices d
left join public.users u on u.tg_id=d.user_id where u.id is null;

select chat_id, user_id, count(*) from public.chat_keys
group by chat_id,user_id having count(*) > 1;
select user_id, device_id, count(*) from public.user_devices
group by user_id,device_id having count(*) > 1;
select least(requester_id,addressee_id) as user_a,
       greatest(requester_id,addressee_id) as user_b,
       count(*)
from public.friendships
group by 1,2 having count(*) > 1;

select * from public.debts where amount <= 0 or creditor_id=debtor_id or btrim(currency)='';
select * from public.currencies where rub_value <= 0 or btrim(name)='';
select * from public.chats where type not in ('private','group','saved') or btrim(name)='';
