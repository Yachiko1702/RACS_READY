document.addEventListener('DOMContentLoaded', function () {

  // ---------- Initialize AOS (scroll animations) ----------
  AOS.init({
    duration: 800,      // smoother and slower animation
    easing: 'ease-in-out',
    once: true          // animate only once per element
  });

  // Force AOS refresh after initial paint
  if (window.AOS && typeof AOS.refresh === 'function') {
    AOS.refresh();
  }

  // ---------- Bootstrap Carousel optimization ----------
  const carousel = document.querySelector('#section2Carousel');
  if (carousel) {
    carousel.addEventListener('slide.bs.carousel', () => {
      carousel.style.willChange = 'transform';
    });
    carousel.addEventListener('slid.bs.carousel', () => {
      carousel.style.willChange = 'auto';
    });
  }

  // ---------- Optional Custom Carousel (if exists) ----------
  if (typeof custom !== 'undefined' && custom) {
    const items = Array.from(custom.querySelectorAll('.carousel__item'));
    const dots = Array.from(custom.querySelectorAll('.carousel__nav button'));
    let idx = items.findIndex(i => i.classList.contains('active'));
    if (idx < 0) idx = 0; // fallback

    const interval = 4500;
    let timer = null;

    function show(i) {
      items.forEach((it, j) => it.classList.toggle('active', j === i));
      dots.forEach((d, j) => d.classList.toggle('active', j === i));
      idx = i;
    }

    // Show first slide immediately
    show(idx);

    // Dots navigation
    dots.forEach((d, i) => {
      d.addEventListener('click', () => {
        show(i);
        resetTimer();
      });
    });

    // Autoplay
    function startTimer() {
      timer = setInterval(() => show((idx + 1) % items.length), interval);
    }
    function resetTimer() {
      clearInterval(timer);
      startTimer();
    }

    custom.addEventListener('mouseenter', () => clearInterval(timer));
    custom.addEventListener('mouseleave', resetTimer);

    setTimeout(() => {
      startTimer();
    }, 800);
  }

});
