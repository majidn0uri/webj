import { NextRequest, NextResponse } from 'next/server';
import { api } from '@/lib/api';
import { requestBase } from '@/lib/request-base';

/**
 * بازگشت از درگاه.
 *
 * چرا این مسیر یک Route Handler است و نه یک صفحه؟
 *   • زرین‌پال با GET برمی‌گرداند (Authority و Status)، آی‌دی‌پی با POST؛
 *     یک Route Handler می‌تواند هر دو را بپذیرد، یک صفحه نه.
 *   • تأییدِ واقعی باید سمتِ سرور انجام شود. مرورگر فقط پارامترها را می‌آورد؛
 *     تصمیم را درگاه می‌دهد، نه نشانیِ مرورگر.
 *
 * نکته‌ی امنیتی: پارامترِ Status را باور نمی‌کنیم. حتی اگر کسی دستی
 * `?Status=OK` بسازد، باز هم از درگاه می‌پرسیم؛ اگر درگاه نپذیرد،
 * سفارش تسویه نمی‌شود.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  let body: Record<string, string> = {};

  if (req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    if (form) for (const [k, v] of form.entries()) body[k] = String(v);
  }

  // هر درگاه نامِ خودش را دارد: زرین‌پال Authority، آی‌دی‌پی id
  const authority = params.get('Authority') ?? params.get('authority') ?? body.Authority ?? body.id ?? body.authority;
  const status = params.get('Status') ?? params.get('status') ?? body.Status ?? body.status;

  const base = requestBase(req);

  if (!authority) {
    return NextResponse.redirect(`${base}/pay/result?error=no-authority`, 303);
  }

  // چرا با Status=NOK هم باز تأیید را صدا می‌زنیم؟
  // چون اگر فقط به نشانی اعتماد کنیم، ردیفِ پرداخت تا ابد «در انتظار» می‌ماند
  // و پنلِ مدیریت وضعیتی غلط نشان می‌دهد. نتیجه‌ی واقعی را همیشه درگاه می‌گوید؛
  // Status فقط برای گزارش است و هیچ تصمیمی با آن گرفته نمی‌شود.
  void status;

  try {
    const result = await api.verifyPayment(authority);
    const target = new URL('/pay/result', base);
    target.searchParams.set('authority', authority);
    target.searchParams.set('outcome', result.status);
    if (result.orderNo) target.searchParams.set('order', result.orderNo);
    if (result.paymentId) target.searchParams.set('id', result.paymentId);
    return NextResponse.redirect(target, 303);
  } catch {
    return NextResponse.redirect(`${base}/pay/result?authority=${encodeURIComponent(authority)}&error=verify`, 303);
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
