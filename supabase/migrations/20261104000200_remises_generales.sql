-- Remises générales présentes sur les PDF facture.net (ligne « Remise générale (x %) » puis « Total final »),
-- oubliées lors de l'import. 22 factures, 3 924,50 € de remises au total.
update public.items i
   set data = i.data || jsonb_build_object('remisePct', v.pct), updated_at = now()
  from (values
    ('imp-F230900001', 30.0),
    ('imp-F230900003', 30.0),
    ('imp-F231100001', 30.0),
    ('imp-F231100004', 30.0),
    ('imp-F240100001', 30.0),
    ('imp-F240200003', 30.0),
    ('imp-F240300001', 30.0),
    ('imp-F240400001', 30.0),
    ('imp-F240500001', 30.0),
    ('imp-F240600005', 30.0),
    ('imp-F240700002', 30.0),
    ('imp-F240700005', 25.0),
    ('imp-F240900001', 30.0),
    ('imp-F240900002', 20.0),
    ('imp-F241000001', 30.0),
    ('imp-F241000002', 30.0),
    ('imp-F241200001', 30.0),
    ('imp-F250100002', 30.0),
    ('imp-F250200001', 30.0),
    ('imp-F250300002', 30.0),
    ('imp-F250400001', 30.0),
    ('imp-F260600001', 20.0)
  ) as v(id, pct)
 where i.col = 'docs' and i.id = v.id;

-- F260600001 : on remet le vrai prix (250 €) ; c'est la remise de 20 % qui donne 200 €.
update public.items
   set data = jsonb_set(data, '{lines,0,unit}', '250'::jsonb) - 'correctionNote', updated_at = now()
 where col = 'docs' and id = 'imp-F260600001';
