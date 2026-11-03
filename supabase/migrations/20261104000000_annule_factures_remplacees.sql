-- Factures remplacées par une nouvelle version (annulées dans facture.net) :
-- F260500002 (remplacée par F260500003), F260600003 et F260600004 (remplacées par F260600005).
do $$
declare n integer;
begin
  update public.items
     set data = data || jsonb_build_object('status', 'annulee', 'cancelReason', 'Facture remplacée, annulée dans facture.net', 'paidAssumed', false, 'paidAt', ''),
         updated_at = now()
   where col = 'docs'
     and id in ('imp-F260500002', 'imp-F260600003', 'imp-F260600004');
  get diagnostics n = row_count;
  raise notice 'Factures annulées : %', n;
end $$;
