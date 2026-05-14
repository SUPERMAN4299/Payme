import qrcode 
image = qrcode.make('http://192.168.1.5:3000/')
image.save('code_qr.png')