# SocialHub Full-Stack

Đây là bản full-stack chạy thật trên máy chủ Node.js, gồm:

- Đăng ký / đăng nhập
- Session đăng nhập
- Ví số dư lưu trong SQLite
- Tạo yêu cầu nạp tiền
- QR chuyển khoản: dùng thông tin ngân hàng trong `.env`
- Admin duyệt/từ chối yêu cầu nạp
- Cộng tiền vào ví bằng transaction phía server
- Danh sách dịch vụ
- Mua dịch vụ bằng số dư
- Trừ tiền + tạo đơn hàng bằng transaction
- Lịch sử đơn hàng
- Admin xem user, giao dịch nạp, đơn hàng và cập nhật trạng thái
- Mật khẩu được hash bằng bcrypt

## Chạy

1. Cài Node.js 18+.
2. Giải nén.
3. Mở terminal trong thư mục dự án.
4. Chạy `npm install`.
5. Copy `.env.example` thành `.env`.
6. Đặt `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
7. Nếu muốn QR thật, điền `BANK_ID`, `ACCOUNT_NO`, `ACCOUNT_NAME`.
8. Chạy `npm start`.
9. Mở `http://localhost:3000`.

## Quan trọng về tiền thật

Bản này dùng QR chuyển khoản để hướng dẫn/hiển thị và admin duyệt giao dịch. Nó KHÔNG tự động xác nhận tiền vào tài khoản ngân hàng.

Muốn tự động cộng tiền sau khi khách chuyển khoản, cần tích hợp một dịch vụ thanh toán/đối soát hợp lệ có webhook và xác thực chữ ký ở backend. Không cộng tiền dựa vào dữ liệu từ trình duyệt.

Chỉ cấu hình tài khoản ngân hàng/cổng thanh toán mà bạn có quyền sử dụng. Với người chưa đủ 18 tuổi, việc mở/đứng tên dịch vụ thanh toán cần tuân theo yêu cầu của ngân hàng/cổng thanh toán và có thể cần người đại diện đủ điều kiện.

Các dịch vụ mẫu là dịch vụ social media hợp pháp; không có chức năng tạo/bán tương tác giả hoặc lách khóa nền tảng.


## Đã cấu hình QR
Ngân hàng: MBBank
Số tài khoản: 0866696331
Tên tài khoản: TRAN GIA NAM

Thông tin này được cấu hình trong file `.env` và QR động sẽ điền số tiền + mã chuyển khoản của từng yêu cầu nạp.
