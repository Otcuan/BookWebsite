export type LibraryQuote = {
  text: string;
  author: string;
  source: string;
};

const quotes: readonly LibraryQuote[] = [
  {
    text: "Đọc sách làm con người đầy đặn; đàm luận làm người ta ứng biến; viết lách làm người ta chính xác.",
    author: "Francis Bacon",
    source: "Of Studies",
  },
  {
    text: "Đọc những cuốn sách hay giống như trò chuyện với những trí tuệ ưu tú nhất của những thời đại đã qua.",
    author: "René Descartes",
    source: "Discourse on the Method",
  },
  {
    text: "Sau cùng, quả thật không có thú vui nào bằng đọc sách!",
    author: "Jane Austen",
    source: "Pride and Prejudice",
  },
  {
    text: "Biết bao người đã mở ra một kỷ nguyên mới trong đời mình nhờ đọc một cuốn sách.",
    author: "Henry David Thoreau",
    source: "Walden",
  },
  {
    text: "Tôi không thể sống thiếu sách.",
    author: "Thomas Jefferson",
    source: "Thư gửi John Adams, 1815",
  },
  {
    text: "Không con tàu nào giống một cuốn sách, có thể đưa ta đến những miền đất xa.",
    author: "Emily Dickinson",
    source: "There is no Frigate like a Book",
  },
];

export function selectRandomQuote(): LibraryQuote {
  const randomValue = new Uint32Array(1);
  crypto.getRandomValues(randomValue);
  return quotes[randomValue[0] % quotes.length];
}
