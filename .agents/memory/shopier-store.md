---
name: Shopier mağaza akışı
description: Demlik üyelik mağazasındaki ödeme doğrulama ve süreli yetki kuralları
---

Shopier satın alma dönüşü tek başına ödeme kanıtı değildir. Yerel bekleyen sipariş, Shopier ürün ID’si, tutar, miktar ve imzalı webhook doğrulanmadan yetki verilmemelidir; webhook tekrarları idempotent işlenmelidir.

**Why:** Kullanıcı yetkisinin ödeme doğrulanmadan açılması ve aynı siparişin iki kez işlenmesi güvenlik ve gelir kaybı riski oluşturur.

**How to apply:** Yeni ödeme sağlayıcısı veya webhook değişikliğinde aynı fail-closed yaklaşımı koru; PAT ve webhook token’larını kodda veya yanıtta gösterme.