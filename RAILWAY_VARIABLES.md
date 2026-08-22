# Railway Variables

CigCig production service icin Railway > Service > Variables bolumune ekleyin.

## Reals R2

```text
R2_ACCOUNT_ID=<Cloudflare account ID>
R2_BUCKET_NAME=<R2 bucket name>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<R2 access key ID>
R2_SECRET_ACCESS_KEY=<R2 secret access key>
R2_PUBLIC_URL=https://<public R2 domain>
```

`R2_PUBLIC_URL` Reals videolarinin tarayicida oynatilabilmesi icin onerilir. R2 bucket veya custom domain uzerinden herkese acik bir public URL olmalidir.

## R2 CORS

Direct browser upload icin `reals-cigcig` bucket > Settings > CORS Policy alanina su kurali ekleyin. Production domaininiz farkliysa origin degerini ona gore degistirin.

```json
[
	{
		"AllowedOrigins": ["https://cigcig.xyz", "https://www.cigcig.xyz"],
		"AllowedMethods": ["PUT", "GET", "HEAD"],
		"AllowedHeaders": ["*"],
		"ExposeHeaders": ["ETag", "Content-Length"],
		"MaxAgeSeconds": 3600
	}
]
```

## Fotograflar ve diger medya

Cloudinary kullaniyorsaniz asagidakilerden birini tanimlayin:

```text
CLOUDINARY_URL=cloudinary://<api-key>:<api-secret>@<cloud-name>
```

veya:

```text
CLOUDINARY_CLOUD_NAME=<cloud name>
CLOUDINARY_API_KEY=<api key>
CLOUDINARY_API_SECRET=<api secret>
```

## Diger zorunlu degiskenler

```text
DATABASE_URL=<Railway PostgreSQL connection string>
PORT=8080
```

Not: R2 ve Cloudinary anahtarlarini bu dosyaya veya git reposuna gercek degerleriyle yazmayin. Railway Variables uzerinden girin.
