# Validate Chuyen Xu Ly

Chrome extension Manifest V3 dung de tam thoi chan nut **Chuyen**, them field KPI ben trai nut va log ket qua kiem tra ra console.
Giao dien quan ly cua extension chay bang Chrome Side Panel; click icon extension tren thanh cong cu se mo panel ben phai.

## Cai dat

1. Mo Chrome va vao `chrome://extensions`.
2. Bat **Developer mode**.
3. Chon **Load unpacked**.
4. Chon thu muc nay: `/Users/vinvit/IT/Ext.xa`.

## Cach hoat dong

Trang dang goi inline:

```html
onclick="chuyentiepClick('0');"
```

Extension se inject `injected.js` vao page context de boc lai `window.chuyentiepClick`, dong thoi chan click truc tiep tren button:

```html
#btnActionChuyenXuLy
```

Ben trai button, extension tu them tren cung mot dong:

- `Han xu ly`: input `type=date`, mac dinh la ngay hom truoc.
- `Diem`: input so khong am.
- `Chi xem`: switch checkbox. Khi bat `Chi xem`, khong can nhap `Han xu ly` va `Diem`.
- Khi bat `Chi xem`, extension se luu tam va reset `Han xu ly`/`Diem` cung cac field goc dang dong bo; khi tat `Chi xem`, cac gia tri truoc do se duoc khoi phuc.
- `Han xu ly` dong bo voi input goc `#txtHanXuLyChuyenTiep` theo dinh dang `dd/mm/yyyy`.
- `Diem` dong bo voi textarea `#txtCommentChuyenTiep` bang token `[p:{num}]`, vi du `[p:15]`; token luon dung o dau textarea.
- Neu token point bi xoa hoac sai cu phap, input `Diem` se bi xoa/invalid va chan `Chuyen`.

Che do hien tai van la testing:

- Click `Chuyen` se validate cac field moi them.
- Neu khong bat `Chi xem`, `Han xu ly` bat buoc co va khong duoc nho hon ngay hien tai.
- Neu loi, field loi co border do va trang scroll den field loi dau tien.
- Neu hop le, field co border xanh la.
- Ket qua validate duoc log ra console.
- Hang `SUBMIT_CHANGE_STATUS` trong `injected.js` dinh nghia co goi ham goc `chuyentiepClick` hay khong.
- Mac dinh `SUBMIT_CHANGE_STATUS = false`, extension khong goi ham goc `chuyentiepClick`.
- Khi doi `SUBMIT_CHANGE_STATUS = true`, extension chi goi ham goc neu validate hop le.

## Kiem tra da inject thanh cong

Mo DevTools Console tren trang can chan va chay:

```js
window.__chuyenXuLyValidator
```

Neu inject thanh cong se thay object co `injected: true`.

Kiem tra marker tren DOM:

```js
document.documentElement.dataset.chuyenXuLyValidatorInjected
```

Ket qua dung la:

```js
"1"
```

Kiem tra button da duoc gan guard:

```js
document.querySelector("#btnActionChuyenXuLy")?.dataset.codexChuyenXuLyGuard
```

Ket qua dung la version hien tai, vi du:

```js
"1.2.0"
```

Co the goi test validate ma khong bam nut:

```js
window.__chuyenXuLyValidator.test()
```
