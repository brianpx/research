/* Prevent clickjacking by breaking out of frames */
if (window.top !== window.self) {
    window.top.location = window.self.location;
}
