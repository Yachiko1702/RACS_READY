// Highlight active nav link based on current URL
document.addEventListener('DOMContentLoaded', function() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.navbar-nav .nav-link');

  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    
    // Check if the link matches the current path
    if (href === currentPath || (href === '/' && currentPath === '/')) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
});

// Smooth animated underline on hover - swap effect
document.addEventListener('DOMContentLoaded', function() {
  const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
  
  navLinks.forEach(link => {
    // On hover - show underline
    link.addEventListener('mouseenter', function() {
      navLinks.forEach(l => l.classList.remove('active'));
      this.classList.add('active');
    });
    
    // On mouse leave - restore original active state
    link.addEventListener('mouseleave', function() {
      navLinks.forEach(l => l.classList.remove('active'));
      
      // Restore the active link based on current URL
      const currentPath = window.location.pathname;
      navLinks.forEach(l => {
        const href = l.getAttribute('href');
        if (href === currentPath || (href === '/' && currentPath === '/')) {
          l.classList.add('active');
        }
      });
    });
  });
});
