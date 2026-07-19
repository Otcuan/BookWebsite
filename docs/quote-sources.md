# Nguồn quote

Các câu trên giao diện là bản dịch tiếng Việt ngắn do project biên soạn từ tác
phẩm gốc; không được trình bày như bản dịch chính thức. Danh sách nguồn:

- Francis Bacon, *Of Studies*: https://www.gutenberg.org/files/575/575-h/575-h.htm
- René Descartes, *Discourse on the Method*: https://www.gutenberg.org/files/59/59-h/59-h.htm
- Jane Austen, *Pride and Prejudice*: https://www.gutenberg.org/cache/epub/1342/pg1342.html
- Henry David Thoreau, *Walden*: https://www.gutenberg.org/files/205/205-h/205-h.htm
- Thomas Jefferson, thư gửi John Adams ngày 10/06/1815:
  https://www.monticello.org/encyclopedia/i-cannot-live-without-books-quotation
- Emily Dickinson, *There is no Frigate like a Book*:
  https://poets.org/poem/there-no-frigate-book-1263

Quote được chọn ở server cho từng request rồi truyền xuống Client Component, vì
vậy nội dung SSR và nội dung hydrate giống nhau. Cách này tránh dùng
`Math.random()` độc lập ở server/client gây hydration mismatch.
