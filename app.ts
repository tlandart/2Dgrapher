declare var math: any;

const c = <HTMLCanvasElement> document.getElementsByClassName("graph-inner")[0];
fitCanvas(c);
const ct = <CanvasRenderingContext2D> c.getContext("2d");
let cHeight = c.offsetHeight;
let cWidth = c.offsetWidth;

// menu elements, we put them here so they only need to be searched for once
const pl = <HTMLCanvasElement> document.getElementsByClassName("menu-label")[0];
const ip = <HTMLCanvasElement> document.getElementsByClassName("menu-input")[0];

// variables for the theme (light/dark)
let light = true;
let themeCol: string;
let themeColInv: string;

// the width of each grid square in pixels when the scaling is 1
const STANDARD_GRID_SIZE = 25;
// how much one zoom adjusts the scaling (i.e. scale*ZOOM_SCALE)
const ZOOM_SCALE = 0.1;
// how many line segments are used to render a function on screen
const FUNCTION_RESOLUTION = cWidth/2;
// the number of pixels between two ScreenPoints before they are no longer considered "close" (used for hovering labels)
const CLOSE_DISTANCE = 15;
// for line segments: the arrow edge length in pixels
const ARROW_LENGTH = 15;
// for line segments: the arrow edge's angle to the original line (in radians)
const ARROW_ANGLE = Math.PI/8;

// **************** BACKEND STUFF BELOW ****************

interface RealObject {
    color: string;
    isValid(): boolean;
    toString(): string;
    equals(o: Object): boolean;
    copy(): RealObject;
}

class Point implements RealObject {
    color: string;
    x: number;
    y: number;

    constructor(x?: number, y?: number) {
        this.color = "#00ccff";
        if(x !== undefined) this.x = x;
        else this.x = 0;
        if(y !== undefined) this.y = y;
        else this.y = 0;
    }

    translate(x?: number, y?: number) {
        // move by the specified amount
        if(x !== undefined) this.x += x;
        if(y !== undefined) this.y += y;
    }

    public isValid(): boolean {
        if(isNaN(this.x) || isNaN(this.y)) return false;
        return true;
    }

    public toString = () : string => {
        return "(" + this.x + "," + this.y + ")";
    }

    public equals(o: Object): boolean {
        if(o === undefined) return false;
        else if(!(o instanceof Point)) return false;
        else return (this.x === o.x && this.y === o.y);
    }

    // return a deep copy of the object
    public copy(): Point {
        return new Point(this.x,this.y);
    }
}

// used to represent a point on the actual grid
class RealPoint extends Point {
}

// used to represent a point on the screen
class ScreenPoint extends Point {
    public toString = () : string => {
        return "(" + this.x + "," + this.y + ") [Screen Point]";
    }
}

class Line implements RealObject {
    color: string;
    start: RealPoint;
    end: RealPoint;

    constructor(start?: RealPoint, end?: RealPoint) {
        this.color = "#ff0000";
        if(start !== undefined) this.start = start;
        else this.start = new RealPoint();
        if(end !== undefined) this.end = end;
        else this.end = new RealPoint();
    }
    
    public isValid(): boolean {
        if(!this.start.isValid() || !this.end.isValid())
            return false;
        return true;
    }

    public toString = () : string => {
        return this.start + " => " + this.end;
    }

    public equals(o: Object): boolean {
        if(o === undefined) return false;
        else if(!(o instanceof Line)) return false;
        else return (this.start === o.start && this.end === o.end);
    }

    // return a deep copy of the object
    public copy(): Line {
        return new Line(this.start.copy(), this.end.copy());
    }
}

class RealFunction implements RealObject {
    color: string;
    f: (n: number) => number;
    private rhs: string;

    constructor(rhs?: string) {
        this.color = "#ffcc00";
        if(rhs === undefined) {
            // the default function is f(x)=x
            this.rhs = "x";
            this.f = (n: number) => { return n; };
        }
        else {
            this.rhs = rhs;
            const code = math.parse(rhs).compile();
            this.f = (n: number) => {
                return code.evaluate({x: n});
            }
        }
    }

    public derivative(): RealFunction {
        if(this.rhs !== undefined) {
            return new RealFunction(math.derivative(this.rhs, 'x').toString());
        }
    }

    public isValid(): boolean {
        try {
            this.f(0);
        }
        catch(e) {
            // if theres an error it means that code.evaluate threw an error because the input is not correct so the function cannot be defined and is not valid
            return false;
        }
        return true;
    }

    public toString = () : string => {
        return "f(x)=" + this.rhs;
    }

    public equals(o: Object): boolean {
        if(o === undefined) return false;
        else if(!(o instanceof RealFunction)) return false;
        else return this.rhs === o.rhs;
    }

    // return a deep copy of the object
    public copy(): RealFunction {
        return new RealFunction(this.rhs);
    }
}

class RealText implements RealObject {
    text: string;
    point: RealPoint;
    color: string;

    constructor(text?: string, point?: RealPoint, color?: string) {
        if(point !== undefined) this.text = text;
        else this.text = "";
        if(point !== undefined) this.point = point;
        else this.point = new RealPoint();
        if(color !== undefined) this.color = color;
        else this.color = "#ff0000";
    }

    // helper for isValid (FROM https://stackoverflow.com/a/56266358)
    private isColor = (strColor) => {
        const s = new Option().style;
        s.color = strColor;
        return s.color !== '';
    }
    
    public isValid(): boolean {
        // check if the point is valid and if the color string is actually a color. the text can by anything
        if(!this.point.isValid() || !this.isColor(this.color))
            return false;
        return true;
    }

    public toString = () : string => {
        return this.text + ", Color: " + this.color + "at " + this.point.toString();
    }

    public equals(o: Object): boolean {
        if(o === undefined) return false;
        else if(!(o instanceof RealText)) return false;
        else return (this.text === o.text && this.color === o.color && this.point.equals(o.point));
    }

    // return a deep copy of the object
    public copy(): RealText {
        return new RealText(this.text,this.point,this.color);
    }
}

class Grid {
    cameraPos: RealPoint;
    label: RealText;
    scale: number;
    lines: Line[];
    points: RealPoint[];
    functions: RealFunction[];

    constructor() {
        this.cameraPos = new RealPoint();
        this.label = new RealText();
        this.scale = 1;
        this.lines = [];
        this.points = [];
        this.functions = [];
    }
}

// **************** FRONTEND STUFF BELOW ****************

class Connection {
    private grid: Grid;

    constructor() {
        this.grid = new Grid();
        this.refresh();
    }

    refresh() {
        this.drawGrid();
        this.updateMenu();
        console.log("refresh");
    }

    public toScreenPoint(p: RealPoint) {
        // translate it on the original grid so the cameraPos is the new origin (w cameraPos)
        p = new RealPoint(p.x - this.cameraPos.x, p.y - this.cameraPos.y);
        /* 1. start at the origin, [width/2, height/2] and its (this.cameraPos.x, this.cameraPos.y)
         * 2. add STANDARD_GRID_SIZE*this.scale*p.x to [width/2, height/2] and same for y but subtract
        */
        return new ScreenPoint(
            cWidth/2 + STANDARD_GRID_SIZE*this.scale*p.x,
            cHeight/2 - STANDARD_GRID_SIZE*this.scale*p.y,
        );
    }

    public toRealPoint(p: ScreenPoint) {
        // reverse the operations that we did in toScreenPoint()
        p = new ScreenPoint(
            (p.x - cWidth/2)/(STANDARD_GRID_SIZE*this.scale),
            -(p.y - cHeight/2)/(STANDARD_GRID_SIZE*this.scale)
        );
        return new RealPoint(p.x + this.cameraPos.x, p.y + this.cameraPos.y);
    }

    // helper
    isOnScreen(p: RealPoint) {
        // determines if a RealPoint is on screen or not
        let pScreen: ScreenPoint = this.toScreenPoint(p);
        if(pScreen.x > cWidth || pScreen.x < 0 || pScreen.y > cHeight || pScreen.y < 0) return false;
        return true;
    }

    // draw a line with two RealPoints
    private drawLine(start: RealPoint, end: RealPoint, colorHex?: string, thickness?: number) {
        if(colorHex === undefined) colorHex = "#ffffff";
        if(thickness === undefined) thickness = 2;

        const startNew = this.toScreenPoint(start);
        const endNew = this.toScreenPoint(end);
        
        ct.beginPath();
        ct.moveTo(startNew.x, startNew.y);
        ct.lineTo(endNew.x, endNew.y);
        ct.lineWidth = thickness;
        ct.strokeStyle = colorHex;
        ct.stroke();
    }

    // an "axis" here is defined as a line that spans from one side of the screen to the other
    private drawAxis(vertical: boolean, point: RealPoint, colorHex?: string, thickness?: number) {
        if(colorHex === undefined) colorHex = "#ffffff";
        if(thickness === undefined) thickness = 2;

        const pointNew = this.toScreenPoint(point);
        
        ct.beginPath();
        if(vertical) {
            ct.moveTo(pointNew.x, 0);
            ct.lineTo(pointNew.x, cHeight);
        }
        else {
            ct.moveTo(0, pointNew.y);
            ct.lineTo(cWidth, pointNew.y);
        }
        ct.lineWidth = thickness;
        ct.strokeStyle = colorHex;
        ct.stroke();
    }

    private drawCircle(center: RealPoint, radius: number, colorHex?: string, full?: boolean, thickness?: number) {
        if(colorHex === undefined) colorHex = "#ffffff";
        if(thickness === undefined) thickness = 2;
        if(full === undefined) full = false;

        const centerNew = this.toScreenPoint(center);
        
        ct.beginPath();
        ct.arc(centerNew.x, centerNew.y, radius, 0, 2*Math.PI)
        ct.lineWidth = thickness;
        ct.strokeStyle = colorHex;
        ct.fillStyle = colorHex;
        if(full) ct.fill();
        ct.stroke();
    }

    private drawText(topLeft: RealPoint, text: string, colorHex?: string, strokeHex?: string, fontsize?: number) {
        if(fontsize === undefined) fontsize = 30;
        if(colorHex === undefined) colorHex = "#ffffff";
        if(strokeHex === undefined) strokeHex = "#ffffff";

        const topLeftNew = this.toScreenPoint(topLeft);
        //topLeftNew.translate(fontsize/4,-fontsize/6); // move it a bit so its nice

        ct.beginPath();
        ct.font = "bold " + fontsize + "px Arial";
        ct.fillStyle = colorHex;
        ct.textAlign = "center";
        ct.lineWidth = 2;
        ct.strokeStyle = strokeHex;
        ct.strokeText(text, topLeftNew.x, topLeftNew.y); // add a stroke of the opposite color
        ct.fillText(text, topLeftNew.x, topLeftNew.y);

    }

    private drawFunction(theFunction: RealFunction, colorHex?: string, thickness?: number) {
        const LEFT_X: number = this.toRealPoint(new ScreenPoint(-10,cHeight/2)).x;
        const RIGHT_X: number = this.toRealPoint(new ScreenPoint(cWidth+10,cHeight/2)).x;
        // the real length of each line segment that will be rendered
        const SEGMENT_LENGTH: number = (RIGHT_X-LEFT_X)/FUNCTION_RESOLUTION;
        

        for(let xNew=LEFT_X; xNew<=RIGHT_X; xNew+=SEGMENT_LENGTH) {
            if(theFunction.f(xNew) !== undefined && theFunction.f(xNew+SEGMENT_LENGTH) !== undefined) {
                let start:RealPoint = new RealPoint(xNew,theFunction.f(xNew));
                let end:RealPoint = new RealPoint(xNew+SEGMENT_LENGTH,theFunction.f(xNew+SEGMENT_LENGTH));

                this.drawLine(start,end,colorHex,thickness);
            }
        }
    }

    // helper for drawGrid
    private linearScaler(scale: number) {
        // we want this to be such that:
        // scale=0.1 => L=0.1... scale=0.3 => L=0.1... scale=1 => L=1... scale=3 => L=1...
        // scale=10 => L=10... scale=30 => L=10...
        let i = 0;
        let l = scale;
        if(l < 1) {
            i = -1;
            while(l < 0.1) {
                l = l*10;
                i--;
            }
        }
        else {
            i = -1;
            while(l >= 1) {
                l = l/10;
                i++;
            } // we make l a decimal in interval (0,1) so we can round it up
        }
        return Math.ceil(l)*Math.pow(10,i);
    }

    // helper for drawGrid
    private roundNumber(num: number, to: number) {
        return (Math.round((num + Number.EPSILON) * to) / to);
    }

    // draw the actual grid onto the screen
    private drawGrid() {
        // clear the canvas
        ct.clearRect(0,0,c.width,c.height);

        ct.fillStyle = themeCol;
        ct.fillRect(0,0,c.width,c.height);

        // draw the axes
        const origin = new RealPoint();
        this.drawAxis(false, origin, themeColInv, 3);
        this.drawAxis(true, origin, themeColInv, 3);
        
        // DRAWING GRIDLINES --------

        // used to determine how far apart the grid lines are
        const LINEAR_SCALER = this.linearScaler(this.scale);

        // start on the farthest left gridline on the screen and keep adding vertical gridlines to the right until they go offscreen
        // start left. y-value doesnt matter but it seems that 0 yields slight miscalculations so use something other than that (eg the middle of the screen)
        let axisPoint: RealPoint = this.toRealPoint(new ScreenPoint(0,cHeight/2));
        // get the closest rounded x value that is on screen
        axisPoint.x = Math.ceil(axisPoint.x*LINEAR_SCALER)/LINEAR_SCALER;
        while(this.isOnScreen(axisPoint)) {
            
            // place the line. we use a transparent line so when it goes over the axis it doesnt look weird
            this.drawAxis(true, axisPoint, "rgba(150, 150, 150, 0.5)", 1);

            let labelNum = this.roundNumber(axisPoint.x, LINEAR_SCALER).toString(); // rounding the label to account for errors
            let labelPoint = new RealPoint(axisPoint.x, 0);
            // place the number label
            this.drawText(labelPoint, labelNum.toString(), themeCol, themeColInv, 15);

            // move the point to place the next axis (based on our scale level)t
            axisPoint.translate(1/LINEAR_SCALER,0);
        }
        // same for horizontal lines
        axisPoint = this.toRealPoint(new ScreenPoint(cWidth/2,0));
        axisPoint.y = Math.floor(axisPoint.y*LINEAR_SCALER)/LINEAR_SCALER;
        while(this.isOnScreen(axisPoint)) {
            this.drawAxis(false, axisPoint, "rgba(150, 150, 150, 0.5)", 1);
            
            let labelNum = this.roundNumber(axisPoint.y, LINEAR_SCALER).toString();
            let labelPoint = new RealPoint(0, axisPoint.y);
            
            this.drawText(labelPoint, labelNum.toString(), themeCol, themeColInv, 15);

            axisPoint.translate(0,-1/LINEAR_SCALER);
        }
        // DONE DRAWING GRIDLINES --------

        // draw the functions
        this.functions.forEach(f => {
            this.drawFunction(f, f.color);
        });

        // draw the lines
        this.lines.forEach(line => {
            this.drawLine(line.start, line.end, line.color);

            // draw an arrow on the end of the line------

            // calculate the arrow's length in the real graph (converting the ARROW_LENGTH from a number of pixels to a distance on the graph
            let a: RealPoint = connection.toRealPoint(new ScreenPoint(0,0));
            let b: RealPoint = connection.toRealPoint(new ScreenPoint(ARROW_LENGTH,0));
            const ARROW_LENGTH_REAL: number = Math.abs(a.x - b.x);

            // only draw the arrow if the line is a reasonable length on the screen
            if(pointDistance(line.start,line.end) >= ARROW_LENGTH_REAL) {

                // helper for adding angles (ADAPTED FROM https://stackoverflow.com/a/15109215)
                function rotateAroundPoint(theta: number, origin: RealPoint, p: RealPoint): RealPoint {
                    return new RealPoint(
                        Math.cos(theta)*(p.x - origin.x) - Math.sin(theta)*(p.y - origin.y) + origin.x,
                        Math.sin(theta)*(p.x - origin.x) - Math.cos(theta)*(p.y - origin.y) + origin.y,
                    );
                }

                // 1. create a copy of the line to work with and move it to the origin
                let lineCopy = line.copy();
                lineCopy.end.translate(-lineCopy.start.x,-lineCopy.start.y);
                lineCopy.start = new RealPoint(0,0);
                // 2. find the angle it forms with the positive x-axis CCW
                let theta: number = Math.atan2(lineCopy.end.y,lineCopy.end.x);
                // 3. create two points for the ends of the arrow and rotate them around the end point to the right angle
                let arrowEnd1: RealPoint = new RealPoint(line.end.x + ARROW_LENGTH_REAL, line.end.y);
                let arrowEnd2: RealPoint = new RealPoint(line.end.x + ARROW_LENGTH_REAL, line.end.y);
                arrowEnd1 = rotateAroundPoint(theta+ARROW_ANGLE+Math.PI, line.end, arrowEnd1);
                arrowEnd2 = rotateAroundPoint(theta-ARROW_ANGLE+Math.PI, line.end, arrowEnd2);
                this.drawLine(line.end, arrowEnd1, line.color);
                this.drawLine(line.end, arrowEnd2, line.color);
            }
        });

        // draw the points
        this.points.forEach(point => {
            this.drawCircle(point, 5, point.color, true);
        });

        // draw the label on the mouse
        this.drawText(this.label.point, this.label.text, this.label.color, themeCol, 20);

        // update the menu text
        this.updateMenu();
    }

    private updateMenu() {
        let x: number = this.scale > 10 ? this.cameraPos.x : +this.cameraPos.x.toFixed(2);
        let y: number = this.scale > 10 ? this.cameraPos.y : +this.cameraPos.y.toFixed(2);
        pl.textContent = "Postition: (" + x + ", " + y + ")";
        ip.style.width = pl.style.width;
    }

    public resetView() {
        this.cameraPos = new RealPoint();
        this.scale = 1;
        this.refresh();
    }

    get cameraPos() {
        return this.grid.cameraPos;
    }

    get label() {
        return this.grid.label;
    }

    get scale() {
        return this.grid.scale;
    }

    get lines() {
        return this.grid.lines;
    }

    get points() {
        return this.grid.points;
    }

    get functions() {
        return this.grid.functions;
    }

    set cameraPos(cameraPos: RealPoint) {
        this.grid.cameraPos = cameraPos;
        this.refresh();
    }

    set label(label: RealText) {
        this.grid.label = label;
        this.refresh();
    }

    set scale(scale: number) {
        this.grid.scale = scale;
        this.refresh();
    }

    set lines(lines: Line[]) {
        this.grid.lines = lines;
        this.refresh();
    }

    set points(points: RealPoint[]) {
        this.grid.points = points;
        this.refresh();
    }

    set functions(functions: RealFunction[]) {
        this.grid.functions = functions;
        this.refresh();
    }

    private isDuplicate(o: RealObject, arr: RealObject[]) {
        for(let i=0; i<arr.length; i++) {
            if(arr[i].equals(o)) return true;
        }
        return false;
    }

    addPoint(point: RealPoint) {
        if(point.isValid() && !this.isDuplicate(point,this.grid.points)) {
            console.log("adding " + point);
            this.grid.points.push(point);
            this.refresh();
        }
    }

    removeLastPoint() {
        this.grid.points.pop();
        this.refresh();
    }

    addLine(line: Line) {
        if(line.isValid() && !this.isDuplicate(line,this.grid.lines)) {
            console.log("adding " + line);
            this.grid.lines.push(line);
            this.refresh();
        }
    }

    removeLastLine() {
        this.grid.lines.pop();
        this.refresh();
    }

    addFunction(theFunction: RealFunction) {
        if(theFunction.isValid() && !this.isDuplicate(theFunction,this.grid.functions)) {
            console.log("adding " + theFunction);
            this.grid.functions.push(theFunction);
            this.refresh();
        }
    }

    removeLastFunction() {
        this.grid.functions.pop();
        this.refresh();
    }
}

function fitCanvas(c: HTMLCanvasElement) {
    c.style.width = "100%";
    c.style.height = "100%";
    c.width = c.offsetWidth;
    c.height = c.offsetHeight;
}

// refresh the connection every time the window is resized
onresize = (e) => {
    cHeight = c.offsetHeight;
    cWidth = c.offsetWidth;
    fitCanvas(c);
    connection.refresh();
};

// DRAG FEATURE AND HOVER FEATURE
let mouseDown: boolean = false;
let mouseXCurrent: number = -1;
let mouseYCurrent: number = -1;
onmousedown = (e) => {
    mouseDown = true;
    c.style.cursor = "grabbing";

    // draw the crosshair
    //connection.refresh();
    //connection.drawCircle(connection.cameraPos, 5, "rgb(0,0,0,0.5)");
}
onmouseup = (e) => {
    mouseDown = false;
    c.style.cursor = "auto";
    //connection.refresh();
}

// helper function for determining if two ScreenPoints are "close" to each other
function isScreenPointNear(p1: ScreenPoint, p2: ScreenPoint): boolean {
    let dist: number = pointDistance(p1, p2);
    if(dist <= CLOSE_DISTANCE) return true;
    return false;
}

// helper function for getting the distance between two points
function pointDistance(a: Point, b: Point): number {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

onmousemove = (e) => {
    if(document.elementFromPoint(mouseXCurrent, mouseYCurrent) === c) {

        // unfocus all the text fields in the menu if we're hovered over the canvas
        (document.activeElement as HTMLElement).blur();

        const OLD_POINT: RealPoint = connection.toRealPoint(new ScreenPoint(mouseXCurrent, mouseYCurrent));
        const NEW_POINT: RealPoint = connection.toRealPoint(new ScreenPoint(e.clientX, e.clientY));

        // convert CLOSE_DISTANCE from amount of pixels to a distance on the real graph
        let a: RealPoint = connection.toRealPoint(new ScreenPoint(0,0));
        let b: RealPoint = connection.toRealPoint(new ScreenPoint(CLOSE_DISTANCE,0));
        const CLOSE_DISTANCE_REAL: number = Math.abs(a.x - b.x);

        // is there a label that needs to be drawn? if not, we will reset the label to empty later on
        let isLabel: boolean = false;

        // we will check if its hovering over any RealObject and place a label if it is ------

        // 1. check the points
        for(let i=0; i<connection.points.length; i++) {
            if(isScreenPointNear(connection.toScreenPoint(connection.points[i]), new ScreenPoint(e.clientX, e.clientY))) {
                connection.label = new RealText(connection.points[i].toString(), NEW_POINT, connection.points[i].color);
                isLabel = true;
            }
        }

        //2. check the lines (uses similar algorithm as functions below)
        for(let i=0; i<connection.lines.length; i++) {

            // shortcut for the line
            let line: Line = connection.lines[i];

            // find the point on the line closest to the mouse (FROM https://stackoverflow.com/a/24044684)
            let lerp: (a: number,b: number,x: number) => (number) = (a: number,b: number,x: number) => { return(a+x*(b-a)); };
            
            var dx=line.end.x-line.start.x;
            var dy=line.end.y-line.start.y;
            var t=((NEW_POINT.x-line.start.x)*dx+(NEW_POINT.y-line.start.y)*dy)/(dx*dx+dy*dy);
            var lineX=lerp(line.start.x, line.end.x, t);
            var lineY=lerp(line.start.y, line.end.y, t);
            
            let closestPoint: RealPoint = new RealPoint(lineX,lineY);
            let closestScreenPoint: ScreenPoint = connection.toScreenPoint(closestPoint);
            
            // find distance from mouse to that point on the line (in pixels, not on the real grid)
            let dist: number = pointDistance(closestScreenPoint, new ScreenPoint(e.clientX, e.clientY));

            // if its not in bounds, then make it so it won't draw the label later on
            if(line.end.x >= line.start.x) { // x bounds
                if(closestPoint.x > line.end.x+CLOSE_DISTANCE_REAL/2 || closestPoint.x < line.start.x-CLOSE_DISTANCE_REAL/2) dist = CLOSE_DISTANCE + 1;
            }
            else {
                if(closestPoint.x < line.end.x-CLOSE_DISTANCE_REAL/2 || closestPoint.x > line.start.x+CLOSE_DISTANCE_REAL/2) dist = CLOSE_DISTANCE + 1;
            }
            if(line.end.y >= line.start.y) { // y bounds
                if(closestPoint.y > line.end.y+CLOSE_DISTANCE_REAL/2 || closestPoint.y < line.start.y-CLOSE_DISTANCE_REAL/2) dist = CLOSE_DISTANCE + 1;
            }
            else {
                if(closestPoint.y < line.end.y-CLOSE_DISTANCE_REAL/2 || closestPoint.y > line.start.y+CLOSE_DISTANCE_REAL/2) dist = CLOSE_DISTANCE + 1;
            }

            // if the distance is small enough AND the closest point to the mouse is on the line SEGMENT, then draw the label
            if(dist <= CLOSE_DISTANCE) {
                connection.label = new RealText(line.toString(), NEW_POINT, line.color);

                isLabel = true;

                // for testing, draw the tangent line and the closest point to the mouse
                /*connection.refresh();
                connection.drawLine(line.start,line.end,"#0000ff");
                connection.drawCircle(connection.toRealPoint(closestScreenPoint),5,"#ffcc00",true);*/
            }
        }

        //3. check the functions
        for(let i=0; i<connection.functions.length; i++) {
            // idea: create a circle at the mouse that expands outwards by a certain rate (i guess by one pixel? idk) until it intersects the function. the radius is the distance to the function and if the radius < CLOSE_DISTANCE then draw the label
            // idea: create a shape that wraps around the function by CLOSE_DISTANCE and if the mouse is inside that then draw the label
            //   - you could do this one by getting the perpendicular vector at every point (i guess per the resolution of the function) with length CLOSE_DISTANCE and make a shape out of all those vectors
            //  - then use RAY CASTING (https://stackoverflow.com/a/218081) to check if the mouse is inside the polygon

            // METHOD 1: we will simulate the function by drawing a point and incrementing right and seeing if the mouse is "close" to the point. this works well when the curve has a low slope but does not work well for curves with high slopes
            /*let isInBounds: boolean = false;
            let leftX: number = e.clientX - CLOSE_DISTANCE;

            while(leftX < e.clientX + CLOSE_DISTANCE) {
                let checkPoint: ScreenPoint = new ScreenPoint(leftX, e.clientY);
                let checkPointReal: RealPoint = connection.toRealPoint(checkPoint);
                let closePoint: ScreenPoint = connection.toScreenPoint(new RealPoint(checkPointReal.x, connection.functions[i].f(checkPointReal.x)));

                connection.drawCircle(connection.toRealPoint(closePoint),2,"#0000ff",true);
                connection.drawCircle(connection.toRealPoint(checkPoint),1,"#ff0000",true);

                if(isScreenPointNear(closePoint, new ScreenPoint(e.clientX, e.clientY))) {
                    isInBounds = true;
                    break;
                }

                // calculate the next iteration
                let nextCheckPoint: ScreenPoint = new ScreenPoint(leftX+1, e.clientY);
                let nextCheckPointReal: RealPoint = connection.toRealPoint(nextCheckPoint);
                let nextClosePoint: ScreenPoint = connection.toScreenPoint(new RealPoint(nextCheckPointReal.x, connection.functions[i].f(nextCheckPointReal.x)));

                // see if the y value between them is too far
                let dist: number = Math.abs(nextClosePoint.y - closePoint.y);

                if(dist >= 2*CLOSE_DISTANCE && closePoint.y >= 0 && closePoint.y <= cHeight) {
                    // increment the position for the next collision point 
                    leftX += 1/(dist/CLOSE_DISTANCE);
                }
                else {
                    leftX += 1;
                }
            }

            let funcPoint: ScreenPoint = connection.toScreenPoint(new RealPoint(NEW_POINT.x, connection.functions[i].f(NEW_POINT.x)));
            if(isScreenPointNear(funcPoint, new ScreenPoint(e.clientX, e.clientY))) {
                isInBounds = true;
            }

            if(isInBounds) {
                connection.refresh();
                connection.drawText(NEW_POINT, connection.functions[i].toString(), "#00ff00", 20);
            }*/

            // METHOD 2: create a first order taylor series for the function at that x value and then use https://stackoverflow.com/a/24044684
            // this method is better as the label will always show however it does not work very well for when the line has a VERY high slope (i.e. x^100)

            // shortcut for the function
            let theFunction: RealFunction = connection.functions[i];

            // the point on the function at the same x value as the mouse
            let functionXPoint: RealPoint = new RealPoint(NEW_POINT.x, theFunction.f(NEW_POINT.x));

            // create the first order taylor series (tangent line) at the mouse x point
            // f(x) = f(a)+f'(a)(x-a)
            let taySeries: RealFunction = new RealFunction(
                theFunction.f(functionXPoint.x).toString() + " + " + theFunction.derivative().f(functionXPoint.x).toString() + "(x-" + functionXPoint.x.toString() + ")"
            );

            // make sure the line segment we will be using is the same length as CLOSE_DISTANCE_REAL (we'll do that iteratively)
            let deltaX: number = 0;

            let taySeriesStart: RealPoint = new RealPoint(NEW_POINT.x-deltaX, taySeries.f(NEW_POINT.x-deltaX));
            let taySeriesEnd: RealPoint = new RealPoint(NEW_POINT.x+deltaX, taySeries.f(NEW_POINT.x+deltaX));

            let pSize: number = CLOSE_DISTANCE_REAL/CLOSE_DISTANCE; // the real distance of one pixel
            // keep increasing the size of the taylor series line segment until it is the right size
            while(pointDistance(taySeriesStart, taySeriesEnd) < CLOSE_DISTANCE_REAL*2) {
                deltaX += pSize;
                taySeriesStart = new RealPoint(NEW_POINT.x-deltaX, taySeries.f(NEW_POINT.x-deltaX));
                taySeriesEnd = new RealPoint(NEW_POINT.x+deltaX, taySeries.f(NEW_POINT.x+deltaX));
            }

            // find the point on the taylor series closest to the mouse (FROM https://stackoverflow.com/a/24044684)
            let lerp: (a: number,b: number,x: number) => (number) = (a: number,b: number,x: number) => { return(a+x*(b-a)); };
            
            var dx=taySeriesEnd.x-taySeriesStart.x;
            var dy=taySeriesEnd.y-taySeriesStart.y;
            var t=((NEW_POINT.x-taySeriesStart.x)*dx+(NEW_POINT.y-taySeriesStart.y)*dy)/(dx*dx+dy*dy);
            var lineX=lerp(taySeriesStart.x, taySeriesEnd.x, t);
            var lineY=lerp(taySeriesStart.y, taySeriesEnd.y, t);
            
            let taySeriesPoint: RealPoint = new RealPoint(lineX,lineY);
            let taySeriesScreenPoint: ScreenPoint = connection.toScreenPoint(taySeriesPoint);
            
            // find distance from mouse to the point on the taylor series (in pixels, not on the real grid)
            let dist: number = pointDistance(taySeriesScreenPoint, new ScreenPoint(e.clientX, e.clientY));

            // if its not in bounds, then make it so it won't draw the label
            if(taySeriesPoint.x > taySeriesEnd.x && taySeriesPoint.x < taySeriesStart.x) dist = CLOSE_DISTANCE + 1; // x bounds
            if(taySeriesEnd.y >= taySeriesStart.y) { // y bounds
                if(taySeriesPoint.y > taySeriesEnd.y || taySeriesPoint.y < taySeriesStart.y) dist = CLOSE_DISTANCE + 1;
            }
            else {
                if(taySeriesPoint.y < taySeriesEnd.y || taySeriesPoint.y > taySeriesStart.y) dist = CLOSE_DISTANCE + 1;
            }

            // if the distance is small enough AND in bounds, then draw the label
            if(dist <= CLOSE_DISTANCE) {
                //connection.refresh();

                // draw a point on the line
                //connection.drawCircle(functionXPoint,5,theFunction.color,true);
                // draw the label
                //connection.drawText(NEW_POINT, theFunction.toString(), theFunction.color, 20);
                connection.label = new RealText(theFunction.toString(), NEW_POINT, theFunction.color);

                isLabel = true;

                // for testing, draw the tangent line and the closest point to the mouse
                /*connection.drawLine(taySeriesStart,taySeriesEnd,"#0000ff");
                connection.drawCircle(connection.toRealPoint(taySeriesScreenPoint),5,"#ffcc00",true);*/
            }
        }

        if(!isLabel && connection.label.text.length > 0) connection.label = new RealText();
        
        // logic for click and drag to move camera
        if(mouseDown) {
            c.style.cursor = "grabbing";
        
            let xDist = NEW_POINT.x-OLD_POINT.x;
            let yDist = NEW_POINT.y-OLD_POINT.y;

            // translate the cameraPos based on the distance from the old mouse point to the new mouse point
            connection.cameraPos = new RealPoint(
                connection.cameraPos.x - xDist,
                connection.cameraPos.y - yDist
            );

            // draw the crosshair
            //connection.refresh();
            //connection.drawCircle(connection.cameraPos, 5, "rgb(0,0,0,0.5)");
        }
        else {
            c.style.cursor = "auto";
        }
    }

    mouseXCurrent = e.clientX;
    mouseYCurrent = e.clientY;
}

// ZOOM FEATURE
onwheel = (e) => {
    // zoom out
    if(e.deltaY > 0) {
        // change scale
        connection.scale = connection.scale*(1-ZOOM_SCALE);

        // TODO translate the cameraPos based on the distances
        //connection.cameraPos = new RealPoint(connection.cameraPos.x - xDist, connection.cameraPos.y - yDist);
    }
    // zoom in
    else if(e.deltaY < 0) {
        connection.scale = connection.scale*(1+ZOOM_SCALE);

        // translate the cameraPos based on the distances
        //connection.cameraPos = new RealPoint(connection.cameraPos.x + xDist, connection.cameraPos.y + yDist);
    }
};

onkeydown = (e) => {
    if(e.key === "r") {
        connection.resetView();
    }
    if(e.key === "t") {
        changeTheme();
    }
}

function zoomIn() {
    connection.scale = connection.scale*(1+(ZOOM_SCALE*2));
}
function zoomOut() {
    connection.scale = connection.scale*(1-(ZOOM_SCALE*2));
}
function resetView() {
    connection.resetView();
}

function loadFunctionKeyPress(event) {
    if(event.key === "Enter") {
        loadFunction();
    }
}
function loadFunction() {
    var functionInput = <HTMLInputElement> document.getElementById("function-input-box");
    if(functionInput.value !== "") {
        connection.addFunction(new RealFunction(functionInput.value));
    }
    functionInput.value = "";
}
function undoFunction() {
    connection.removeLastFunction();
}

function loadPointKeyPress(event) {
    if(event.key === "Enter") {
        loadPoint();
    }
}
function loadPoint() {
    const REX: RegExp = /\(.*,.*\)/gm;
    const pointInput = <HTMLInputElement> document.getElementById("point-input-box");
    const INPUT = pointInput.value;
    pointInput.value = "";

    if(REX.test(INPUT)) {
        let commaPosition: number = INPUT.indexOf(",");

        let inputSplit: string[] = [];
        inputSplit.push(INPUT.slice(1,commaPosition));
        inputSplit.push(INPUT.slice(commaPosition+1,INPUT.length-1));

        let inputFinal: number[] = [];

        for(let i=0; i<inputSplit.length; i++) {
            let a: number;
            try {
                a = math.evaluate(inputSplit[i]);
            }
            catch(e) {
                a = undefined;
            }
            inputFinal.push(a);
        }
        connection.addPoint(new RealPoint(inputFinal[0], inputFinal[1]));
    }
}
function undoPoint() {
    connection.removeLastPoint();
}

function loadLineKeyPress(event) {
    if(event.key === "Enter") {
        loadLine();
    }
}
function loadLine() {
    // the regex that matches a thing like "(___,___),(___,___)" (use https://regex101.com/)
    const REX: RegExp = /\(.*,.*\),\(.*,.*\)/gm;
    const lineInput = <HTMLInputElement> document.getElementById("line-input-box");
    const INPUT = lineInput.value;
    lineInput.value = "";

    // we only load the line if its the right format
    if(REX.test(INPUT)) {
        let commaPositions: number[] = [];
        commaPositions.push(INPUT.indexOf(","));
        commaPositions.push(INPUT.indexOf(",",commaPositions[0]+1));
        commaPositions.push(INPUT.indexOf(",",commaPositions[1]+1));

        let parenthesisPositions: number[] = [];
        parenthesisPositions.push(0);
        parenthesisPositions.push(commaPositions[1]-1);
        parenthesisPositions.push(commaPositions[1]+1);
        parenthesisPositions.push(INPUT.length-1);

        let inputSplit: string[] = [];
        inputSplit.push(INPUT.slice(parenthesisPositions[0]+1,commaPositions[0]));
        inputSplit.push(INPUT.slice(commaPositions[0]+1,parenthesisPositions[1]));
        inputSplit.push(INPUT.slice(parenthesisPositions[2]+1,commaPositions[2]));
        inputSplit.push(INPUT.slice(commaPositions[2]+1,parenthesisPositions[3]));

        let inputFinal: number[] = [];

        for(let i=0; i<inputSplit.length; i++) {
            let a: number;
            try {
                a = math.evaluate(inputSplit[i]);
            }
            catch(e) { // if there is an error then the input is not a proper equation so we'll put an undefined thing and that will be handled by the addLine() function later
                a = undefined;
            }
            inputFinal.push(a);
        }
        connection.addLine(new Line(new RealPoint(inputFinal[0], inputFinal[1]), new RealPoint(inputFinal[2], inputFinal[3])));
    }
}
function undoLine() {
    connection.removeLastLine();
}

function teleportToInput(event) {
    if(event.key === "Enter") {
        const REX: RegExp = /\(.*,.*\)/gm;
        let pointInput = <HTMLInputElement> document.getElementsByClassName("menu-input")[0];
        const INPUT = pointInput.value;
        pointInput.value = "";

        if(REX.test(INPUT)) {
            let commaPosition: number = INPUT.indexOf(",");

            let inputSplit: string[] = [];
            inputSplit.push(INPUT.slice(1,commaPosition));
            inputSplit.push(INPUT.slice(commaPosition+1,INPUT.length-1));

            let inputFinal: number[] = [];

            for(let i=0; i<inputSplit.length; i++) {
                let a: number;
                try {
                    a = math.evaluate(inputSplit[i]);
                }
                catch(e) {
                    a = undefined;
                }
                inputFinal.push(a);
            }
            let teleportPoint: RealPoint = new RealPoint(inputFinal[0], inputFinal[1]);
            connection.cameraPos = teleportPoint;
            console.log("teleporting to " + teleportPoint);
        }
    }
}
function initTheme() {

    light = false;

    let button = <HTMLImageElement> document.getElementById("theme-image");
    button.src = light ? "images/light.png" : "images/dark.png"

    themeCol = light ? "rgb(255,255,255)" : "rgb(25,25,25)";
    themeColInv = light ? "rgb(25,25,25)" : "rgb(255,255,255)";

    if(!light) { // if the theme is dark we need to switch the menu colors
        let root: HTMLElement = document.querySelector(":root");
        let temp: string = getComputedStyle(root).getPropertyValue("--primary");
        let temp2: string = getComputedStyle(root).getPropertyValue("--primarydark");
        root.style.setProperty("--primary", temp2);
        root.style.setProperty("--primarydark", temp);
    }
}
function changeTheme() {
    light = !light;

    let button = <HTMLImageElement> document.getElementById("theme-image");
    button.src = light ? "images/light.png" : "images/dark.png"

    // animation stuff, ADAPTED FROM (http://javascriptkit.com/javatutors/requestanimationframe.shtml)

    let starttime: number;
    function incrementTheme(timestamp: DOMHighResTimeStamp, duration: number) {
        let runtime = timestamp - starttime;
        let progress = Math.min(runtime/duration, 1);
        let num = light ? progress*230 + 25 : (1-progress)*230 + 25;
        let numInv = light ? (1-progress)*230 + 25 : progress*230 + 25;
        themeCol = "rgb("+num+","+num+","+num+")";
        themeColInv = "rgb("+numInv+","+numInv+","+numInv+")";
        connection.refresh();
        if(runtime < duration) {
            requestAnimationFrame(function(timestamp) {
                incrementTheme(timestamp, duration);
            });
        }
    }

    requestAnimationFrame(function(timestamp) {
        starttime = timestamp;
        incrementTheme(timestamp, 400); // fade the colors over 400 ms
    });

    // switch primary light and dark colors
    let root: HTMLElement = document.querySelector(":root");
    let temp: string = getComputedStyle(root).getPropertyValue("--primary");
    let temp2: string = getComputedStyle(root).getPropertyValue("--primarydark");
    root.style.setProperty("--primary", temp2);
    root.style.setProperty("--primarydark", temp);
}

initTheme();

let connection = new Connection();

// TODO fix the floating point error on the labels when you zoom out a lot
// TODO make asymptotes render properly instead of being really steep lines
//      - (e.g. f(x) = x^-1)
// TODO handle mobile swipes
// TODO settings to manipulate the constants
// TODO save the grid with cookies