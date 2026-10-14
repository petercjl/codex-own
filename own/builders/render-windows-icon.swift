// Deterministic Windows variant of the repository's editable code-symbol icon.
import AppKit
import Foundation
let output = CommandLine.arguments[1]
if FileManager.default.fileExists(atPath: output) { fatalError("Output exists") }
let image = NSImage(size: NSSize(width:1024,height:1024))
image.lockFocus()
NSColor(calibratedRed:23/255,green:54/255,blue:93/255,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:64,y:64,width:896,height:896),xRadius:206,yRadius:206).fill()
NSColor(calibratedRed:112/255,green:200/255,blue:255/255,alpha:1).setStroke()
for points in [[NSPoint(x:365,y:714),NSPoint(x:180,y:512),NSPoint(x:365,y:310)],[NSPoint(x:659,y:714),NSPoint(x:844,y:512),NSPoint(x:659,y:310)]] {
 let p=NSBezierPath();p.lineWidth=65;p.lineCapStyle = .round;p.lineJoinStyle = .round;p.move(to:points[0]);p.line(to:points[1]);p.line(to:points[2]);p.stroke()
}
NSColor(calibratedRed:243/255,green:190/255,blue:101/255,alpha:1).setStroke()
let slash=NSBezierPath();slash.lineWidth=62;slash.lineCapStyle = .round;slash.move(to:NSPoint(x:574,y:747));slash.line(to:NSPoint(x:450,y:277));slash.stroke()
let badge=NSBezierPath(roundedRect:NSRect(x:702,y:78,width:244,height:244),xRadius:70,yRadius:70)
NSColor(calibratedRed:8/255,green:104/255,blue:201/255,alpha:1).setFill();badge.fill()
NSColor(calibratedRed:185/255,green:228/255,blue:1,alpha:1).setStroke();badge.lineWidth=14;badge.stroke()
NSColor.white.setStroke();let w=NSBezierPath();w.lineWidth=21;w.lineCapStyle = .round;w.lineJoinStyle = .round
w.move(to:NSPoint(x:747,y:255));for point in [NSPoint(x:781,y:146),NSPoint(x:824,y:235),NSPoint(x:867,y:146),NSPoint(x:901,y:255)]{w.line(to:point)};w.stroke()
image.unlockFocus()
let rep=NSBitmapImageRep(data:image.tiffRepresentation!)!
try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:output),options:.withoutOverwriting)
