-- F260600001 (Simon Gandon) : 200 € dans facture.net, le PDF exporté indiquait 250 €.
update public.items
   set data = jsonb_set(data, '{lines,0,unit}', '200'::jsonb) || jsonb_build_object('correctionNote', 'Montant aligné sur facture.net (200 €)'),
       updated_at = now()
 where col = 'docs' and id = 'imp-F260600001'
   and (data #>> '{lines,0,unit}')::numeric = 250;
