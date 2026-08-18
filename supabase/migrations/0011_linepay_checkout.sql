-- LINE Pay 單次檢測付款：付款成功後只允許入帳一次

create table if not exists public.sb_linepay_orders (
  order_id text primary key,
  transaction_id text not null unique,
  user_id uuid not null references public.sb_users(id),
  line_user_id text not null,
  product_code text not null,
  amount integer not null check (amount > 0),
  credits integer not null check (credits > 0),
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists sb_linepay_orders_user_created_idx
  on public.sb_linepay_orders (user_id, created_at desc);

alter table public.sb_linepay_orders enable row level security;
revoke all on table public.sb_linepay_orders from public, anon, authenticated;

create or replace function public.rpc_fulfill_linepay_payment(
  p_order_id text,
  p_transaction_id text,
  p_user_id uuid,
  p_line_user_id text,
  p_product_code text,
  p_amount integer,
  p_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.sb_linepay_orders%rowtype;
  v_credits integer;
begin
  if p_order_id is null or p_order_id !~ '^FM[0-9A-Za-z]{10,40}$' then
    raise exception 'invalid order id';
  end if;
  if p_transaction_id is null or length(p_transaction_id) > 40 then
    raise exception 'invalid transaction id';
  end if;
  if p_product_code <> 'facial-scan-single' or p_amount <> 60 or p_credits <> 1 then
    raise exception 'invalid product';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_order_id, 0));

  select *
    into v_existing
    from public.sb_linepay_orders
   where order_id = p_order_id
   for update;

  if found then
    if v_existing.transaction_id = p_transaction_id
       and v_existing.user_id = p_user_id
       and v_existing.line_user_id = p_line_user_id
       and v_existing.product_code = p_product_code
       and v_existing.amount = p_amount
       and v_existing.credits = p_credits
       and v_existing.status = 'paid' then
      select credits into v_credits from public.sb_users where id = p_user_id;
      return jsonb_build_object(
        'ok', true,
        'already_fulfilled', true,
        'credits', v_credits
      );
    end if;
    raise exception 'order data mismatch';
  end if;

  if not exists (
    select 1
      from public.line_users lu
      join public.sb_users su on su.id = lu.sb_user_id
     where lu.line_user_id = p_line_user_id
       and lu.sb_user_id = p_user_id
       and su.merged_into is null
  ) then
    raise exception 'LINE member binding mismatch';
  end if;

  insert into public.sb_linepay_orders (
    order_id, transaction_id, user_id, line_user_id,
    product_code, amount, credits, status
  ) values (
    p_order_id, p_transaction_id, p_user_id, p_line_user_id,
    p_product_code, p_amount, p_credits, 'paid'
  );

  update public.sb_users
     set credits = credits + p_credits
   where id = p_user_id
     and merged_into is null
  returning credits into v_credits;

  if v_credits is null then
    raise exception 'member not found';
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_fulfilled', false,
    'credits', v_credits
  );
end;
$$;

revoke execute on function public.rpc_fulfill_linepay_payment(
  text, text, uuid, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.rpc_fulfill_linepay_payment(
  text, text, uuid, text, text, integer, integer
) to service_role;
