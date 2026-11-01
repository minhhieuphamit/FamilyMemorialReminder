// Áp dụng giao diện sáng/tối trước khi vẽ trang để không bị nháy màu.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem('theme');
  } catch (e) {}
  var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
})();
