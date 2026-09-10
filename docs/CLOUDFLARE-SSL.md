# گواهی SSL با کلودفلر، قدم‌به‌قدم (مسیری که پورت ۸۰ لازم ندارد)

این مدرک فقط یک چیز را توضیح می‌دهد: چطور `https://vizitik.ir` با ابرِ نارنجیِ کلودفلر
کار کند، بدون اینکه Let's Encrypt بتواند به سرور تو وصل شود. برای همین از چالش **DNS**
استفاده می‌کنیم: ربات Let's Encrypt به جای اتصال به پورت ۸۰، از API کلودفلر می‌خواهد
یک رکورد موقت TXT بسازد؛ این یعنی **هیچ پورتی باید باز نباشد**.

> اجرا روی سرور را با `sudo bash scripts/deploy.sh` انجام بده (همهٔ پروسه‌های قبلی را
> می‌بندد و بعد `setup-server.sh` را صدا می‌زند). این فایل فقط همان چند کلیکِ کلودفلر
> و همان سؤال‌های اسکریپت را توضیح می‌دهد.

---

## ۰) قرار است چه چیزی بسازیم

```
مخاطب  ──https──►  Cloudflare  ──https──►  سرور تو (nginx:443)
                   گواهی اول:              گواهی دوم:
                   Universal SSL رایگان     Let's Encrypt با DNS-01
```

دو گواهی **مستقل** دارند. ۹۰٪ خطاهای «سایت باز نمی‌شود» تصمیمِ اشتباه دربارهٔ همین
میانجی است. وضعیت صحیح نهایی:

| چیزی که می‌بینی | معنی |
|---|---|
| `521 Web server is down` | کلودفلر به origin وصل نشد: ۴۴۳ باز نیست یا nginx پایین است |
| `522 A timeout occurred` | ترافیک بین کلودفلر و سرور گیر می‌کند (فایروال هاست) |
| `525 SSL handshake failed` | حالت روی **Full** است ولی سرور هنوز گواهی ندارد |
| `526 Invalid SSL certificate` | **Full (strict)** با گواهی منقضی/ناخوانا |
| حلقهٔ ریدارکت (ERR_TOO_MANY_REDIRECTS) | **Always Use HTTPS** روشن است ولی حالت روی Flexible است |

---

## ۱) دامنه و سرورهای نام (برای `.ir` این بخش زمان‌بر است)

1. وارد `dash.cloudflare.com` شو → اگر `vizitik.ir` را ندیدی: **Add a site** → پلن **Free** →
   اسکن رکوردها → بعد دو **nameserver** داده می‌شود (مثل `dana.ns.cloudflare.com`).
2. در پنل ثبت‌کننده (برای دامنهٔ ایرانی: ایرنیک) بخش **دامنه‌ها → سرورهای نام / DNS** همان
   دو مورد را ثبت کن. رکوردهای DNS را بعداً **فقط در کلودفلر** می‌سازی، نه در ایرنیک.
3. صبر کن و چک کن (خروجی باید همان دو `ns.cloudflare.com` باشد):

```bash
dig +short NS vizitik.ir @8.8.8.8
```

تا اینجا تغییر NS ممکن است چند ساعت طول بکشد؛ ولی اگر دامنه از قبل در کلودفلر است،
از قدم ۲ ادامه بده.

---

## ۲) رکوردهای DNS (دقیقاً همین دو تا)

مسیر: `dash.cloudflare.com → vizitik.ir → DNS → Records`

| Type | Name | IPv4 address | Proxy status | TTL |
|---|---|---|---|---|
| `A` | `@` | `185.231.115.154` | **Proxied** (ابر نارنجی) | Auto |
| `A` | `www` | `185.231.115.154` | **Proxied** (ابر نارنجی) | Auto |

- هر `CNAME` یا `A` قدیمی که به IP دیگری می‌رفت پاک کن. رکورد `AAAA` لازم نیست.
- با ابر **نارنجی** پورت‌های ورودی لازم نیست باز باشند؛ کلودفلر از سمت خودش مخاطب را
  پاسخ می‌دهد و به سرور فقط ۴۴۳ (و ۸۰) لازم است.
- اگر به‌جای این مسیر، حالت HTTP-01 را انتخاب می‌کنی (ابر **خاکستری / DNS only**) باید
  پورت ۸۰ برای **کل اینترنت** باز باشد؛ مسیر پیشنهادی همین مقاله، DNS-01 است.
- بعد از ذخیره، از روی سرور:

```bash
dig +short A vizitik.ir          # باید IP سرور باشد (اگر خاکستری) یا IP کلودفلر (اگر نارنجی)
dig +short A www.vizitik.ir      # نباید NXDOMAIN باشد؛ نبودش یعنی رکورد www را نساخته‌ای
```

---

## ۳) حالت SSL — همین امشب دو بار عوض می‌شود

مسیر: `dash.cloudflare.com → vizitik.ir → SSL/TLS → Overview` (در پنل جدید: `SSL/TLS → Edge Certificates → …Settings`)

1. **قبل از گواهی** (تا وقتی اسکریپت را اجرا نکرده‌ای): روی **Flexible** بگذار.
   نتیجه: سایت با `https` باز می‌شود، حتی اگر سرور فقط ۸۰ را باز کند. این جلوی ۵۲۱/۵۲۵ را می‌گیرد.
2. **بعد از موفقیت اسکریپت**: روی **Full (strict)** بگذار. حالا مرورگر ← کلودفلر ← سرور
   هر دو طرف TLS دارند.
3. همان‌جا: `Edge Certificates → Always Use HTTPS` را **روشن** کن (فقط بعد از مرحله ۲،
   وگرنه حلقهٔ ریدارکت می‌گیری)، `Minimum TLS Version` را روی **1.2** بگذار،
   و `Universal SSL` باید برای `vizitik.ir` و `*.vizitik.ir` وضعیت **Active** داشته باشد.

---

## ۴) توکن API که اسکریپت لازم دارد (یک بار، ~۲ دقیقه)

1. `dash.cloudflare.com` → آیکون پروفایل (یا `My Account`) → **API Tokens**
2. **Create Token**
3. از تب **API Token Templates** گزینهٔ **Edit zone DNS** را انتخاب کن
   (اگر تب قالب را ندیدی، با **Custom Token** همان یک ردیف مجوز را بساز: `Zone` / `DNS` / `Edit`)
4. پایین فرم: `Zone Resources` → `Include` → `Specific zone` → `vizitik.ir`
5. **Continue → Create Token** → روی **Copy** بزن. **فقط یک بار** نشان داده می‌شود؛
   اگر گم شود، همان‌جا **Roll** کن و توکن جدید بگیر.
6. چیزهایی که **نباید** بدهی: `Global API Key`، توکن با permission بیشتر از `DNS:Edit`،
   یا توکنی که روی `All zones` است (برای این کار لازم نیست).

**الان تستش کن** (روی سرور، از ترمینال SSH؛ این تست ۹۰٪ مشکل‌های توکن را یک‌جا لو می‌دهد):

```bash
T='توکن_را_اینجا_بگذار'
curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=vizitik.ir" \
     -H "Authorization: Bearer $T" | head -c 240
```

- `"success":true` و یک `id` zone ⇒ توکن سالم است. برو قدم ۵.
- `Could not authenticate you` / `Invalid API Key` ⇒ توکن را اشتباه کپی کرده‌ای یا
  Global Key را چسبانده‌ای.
- `Authentication error` + `zone` خالی ⇒ `Zone Resources` را به `vizitik.ir` نداده‌ای.
- `-1004` یا هیچ پاسخی ⇒ سرور به `api.cloudflare.com` وصل نمی‌شود (فایروال خروجی هاست).

---

## ۵) اجرای اسکریپت و معنی سؤال‌ها

```bash
cd ~/Vizitik && git pull
bash scripts/deploy.sh
```

اگر توکن را با دستور زیر بدهی، سؤالش تکرار نمی‌شود (و در لاگ هم نمی‌ماند):

```bash
CF_API_TOKEN='توکن' HTTPS_MODE=dns bash scripts/deploy.sh
```

سؤال‌هایی که می‌پرسد و جواب درست برای این سرور:

| سؤال | جواب | نکته |
|---|---|---|
| `install directory` | Enter | `/opt/vizitik` |
| `public domain of the app` | `vizitik.ir` | خالی = فقط http، بدون گواهی |
| `get a Let's Encrypt certificate` | `y` | |
| `email used for the certificate` | ایمیلت | خالی هم اشکالی ندارد؛ فقط ایمیل اطلاع انقضا نمی‌آید |
| `also serve www.vizitik.ir` | `y` **فقط اگر** قدم ۲ را زده‌ای | اگر رکورد `www` نباشد DNS-01 روی `www.vizitik.ir` می‌افتد؛ بعداً هم `n` زدن قابل جبران است |
| `how should Let's Encrypt prove…` | **`2`** | گزینهٔ ۱ پورت ۸۰ باز به کل اینترنت می‌خواهد |
| `Cloudflare API token…` | توکن قدم ۴ | دو بار می‌خواهد؛ در `/etc/letsencrypt/cloudflare.credentials` با مجوز `600` ذخیره می‌شود |
| `backend port` | Enter | `3000`، فقط روی `127.0.0.1` |
| `database…` | Enter / رمز نو | همان `vizitik_db` قبلی، داده‌ها پاک نمی‌شوند |
| `Bale bot token` | توکن باتر | بدون آن OTP در production فرستاده نمی‌شود |
| `enable the UFW firewall` | `y` | `OpenSSH` و `80,443` باز می‌شوند؛ اگر با پورت غریب ssh می‌زنی، `n` بگو |
| `nightly backup cron` | `y` | |
| `phone of an existing account…` | شمارهٔ حساب اول | برای تست لاگین؛ اکانت را اول در سایت بساز |

خروجی موفق در بخش HTTPS این است:

```
> requesting SSL certificate for vizitik.ir (mode: dns)
> installing the certbot Cloudflare DNS plugin        (اگر نصب نباشد)
  OK  Cloudflare API token written to /etc/letsencrypt/cloudflare.credentials (mode 600)
  OK  HTTPS enabled with a managed certificate (renew check: certbot renew -q)
```

اگر خطا داد، اسکریپت خودش ۱۶ خط آخرِ `/var/log/vizitik-certbot.log` را چاپ می‌کند و
نوع خطا را می‌گوید؛ همان لاگ را برای ما هم بفرست:

```bash
tail -40 /var/log/vizitik-certbot.log
```

---

## ۶) تأیید نهایی (چهار تست، سه ثانیه)

```bash
sudo certbot certificates | head -20
# Should say: Name: vizitik.ir, Domains: vizitik.ir www.vizitik.ir, Expiry Date: ... (90 days)

# گواهیِ بین کلودفلر و سرور باید Let's Encrypt باشد (نه گواهی خود کلودفلر):
curl -sk --resolve vizitik.ir:443:185.231.115.154 -o /dev/null -w '%{http_code}\n' https://vizitik.ir/
echo | openssl s_client -connect 185.231.115.154:443 -servername vizitik.ir 2>/dev/null | grep -E 'issuer|subject'
# issuer = Let's Encrypt ⇒ درست است

ss -ltnp | grep -E ':(80|443)'      # nginx هر دو را دارد
sudo certbot renew --dry-run        # success: renew is wired up
```

در مرورگر: `https://vizitik.ir` → قفل → جزئیات گواهی **Cloudflare** را نشان می‌دهد و این
**صحیح** است (گواهی لبهٔ کلودفلر). گواهی خودت در تست `openssl` بالا دیده می‌شود.
بعد از همه‌چیز یک‌بار **hard reload** (یا DevTools → Application → Service Workers →
Unregister + Clear site data) تا نسخهٔ قدیمیِ کش‌شده از بین برود.

---

## ۷) تمدید خودکار و تمیزکاری

- `certbot renew` از timer خودکار (و اسکریپت ما هم شب‌ها) اجرا می‌شود و فایل اعتبارنامه
  در `/etc/letsencrypt/cloudflare.credentials` می‌ماند، پس **باز هم** به پورت ۸۰ نیازی نیست.
- اگر توکن را **Roll** یا حذف کردی، باید همان توکن نو را در همان فایل بنویسی (یا اسکریپت
  را دوباره با `CF_API_TOKEN=…` اجرا کن)، وگرنه تمدید بعد ۹۰ روز می‌افتد.
- توکن نباید در مخزن باشد؛ اگر جایی لو رفت: `API Tokens → Roll` و بعد:
  `printf 'dns_cloudflare_api_token = NEW\n' | sudo tee /etc/letsencrypt/cloudflare.credentials`
  و `sudo chmod 600` همان فایل.
- اگر روزی چالش DNS با پیام رکورد تکراری گیر کرد: در کلودفلر رکورد
  `_acme-challenge.vizitik.ir` (TXT) را دستی پاک کن.
- بعد از بالا آمدن، برای اطمینان از بسته‌بودن API: `curl -s -o /dev/null -w '%{http_code}\n' http://185.231.115.154:3000/api/auth/send-code`
  باید **connect timeout/connection refused** بدهد، نه پاسخ؛ API فقط از `127.0.0.1` گوش می‌کند.
