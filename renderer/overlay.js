window.murmurOverlay.onStatus(value=>{
  document.body.dataset.state=value.state;
  document.querySelector('#status').textContent=value.title;
  document.querySelector('#hint').textContent=value.hint;
});
