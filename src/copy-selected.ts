import * as sketch from 'sketch'
import {UI} from 'sketch'
import * as dom from 'sketch/dom'

// documentation: https://developer.sketchapp.com/reference/api/
type AllSupportedLayers = Exclude<dom.AllLayers, dom.HotSpot | dom.SymbolMaster>
type ImagesBase64Dictionary = { [id: string]: {[type: string]: string} }
type PinConstraintsDictionary = { [id: string]: {[attribute: string]: boolean} }
type TextsBehaviourDictionary = { [id: string]: number }
type FontsDictionary = { [key: string]: {fontName: string, pointSize: number} }


export default function() {

  var Document = sketch.Document;

  var pasteboard = NSPasteboard.generalPasteboard();
  pasteboard.clearContents();

  var selectedDocument = Document.getSelectedDocument()!;
  var selectedLayers = clearHotSpots(getDuplicatedLayers(selectedDocument.selectedLayers.layers));

  if (userSelectedTwoArtboards(selectedLayers)) {
    UI.alert("You can only copy one Artboard", "");
    return;
  }
  var jsonsArray = []
  var masksArray: string[] = []
  var imagesBase64Json: ImagesBase64Dictionary = {};
  var pinConstraints: PinConstraintsDictionary = {};
  var textsBehavioursDict: TextsBehaviourDictionary = {};
  var fontsJson: FontsDictionary = {};

  (selectedLayers as AllSupportedLayers[]).forEach(function(layer) {
    setFontsDictFromLayer(layer, fontsJson)
    if (setMasksArray(layer, masksArray)) {
      UI.alert("You have choosen a Mask that is not part of a group. Group it", "DO IT")
      return
    }
    setExportableImagesFromLayer(layer, imagesBase64Json)
    setPinConstraintsAndTextsBehaviourDictFromLayer(layer, pinConstraints, textsBehavioursDict)
  })

  jsonsArray = selectedLayers.map( l => l.toJSON() );

  let finalJSON = {
    "plugin": "Sketch",
    "version": 70.3,
    "data": jsonsArray,
    "images": imagesBase64Json,
    "fonts": fontsJson,
    "pinConstraints": pinConstraints,
    "textsBehaviour": textsBehavioursDict,
    "masksArray": masksArray
  };

  pasteboard.setString_forType(JSON.stringify(finalJSON), "io.kodika.kodika.plugins.sketch" as unknown as cocoascript.NSString);

  selectedLayers.forEach( l => l.remove() );
  UI.message("Elements copied successfully! Paste them in the Kodika Design Editor (CMD+V).")
}

function getDuplicatedLayers(layers: dom.AllLayers[]): dom.AllLayers[] {
  let detachedLayers: dom.AllLayers[] = layers.map(function(layer) {
    let duplicatedLayer = layer.duplicate()
    if (duplicatedLayer.type === dom.Types.SymbolInstance) {
      let detachedLayer = duplicatedLayer.detach({ recursively: true });
      duplicatedLayer.remove();
      return detachedLayer;
    }else if (duplicatedLayer.type === dom.Types.SymbolMaster) {
      let symbolInstance = duplicatedLayer.createNewInstance();
      sketch.Document.getSelectedDocument()!.selectedPage.layers.push(symbolInstance);
      let detachedLayer = symbolInstance.detach({ recursively: true });
      duplicatedLayer.remove()
      symbolInstance.remove()
      return detachedLayer
    }
    return duplicatedLayer;
  }).filter(Boolean) as dom.AllLayers[];
  detachedLayers.forEach((layer) => {
    if ('layers' in layer) {
      layer.layers = getDuplicatedLayers(layer.layers) as dom.ChildLayer[]
    }
  });
  return detachedLayers;
}

function clearHotSpots(layers: dom.AllLayers[]): AllSupportedLayers[] {
  let cleanLayers = layers.filter( l => l.type !== 'HotSpot')
  cleanLayers.forEach((layer) => {
    if ('layers' in layer) {
      layer.layers = clearHotSpots(layer.layers) as dom.ChildLayer[]
    }
  });
  return cleanLayers as AllSupportedLayers[]
}

function userSelectedTwoArtboards(layers: AllSupportedLayers[]): boolean {
  var selectedArtboardsCount = 0;
  layers.forEach((layer) => {
    if (layer.type === dom.Types.Artboard) {
      selectedArtboardsCount = selectedArtboardsCount + 1;
    }
  });
  return selectedArtboardsCount > 1;
}

function setFontsDictFromLayer(layer: AllSupportedLayers, fontsJson: FontsDictionary) {
  if (layer.type === dom.Types.Text) {
    let font = layer.sketchObject.font()
    fontsJson[layer.id] = {fontName: String(font.fontName()), pointSize: font.pointSize()}
  }else{
    if ('layers' in layer) {
      (layer.layers as AllSupportedLayers[]).forEach( l => setFontsDictFromLayer(l, fontsJson))
    }
  }
}

function setPinConstraintsAndTextsBehaviourDictFromLayer(layer: AllSupportedLayers, pinConstraints: PinConstraintsDictionary, textsBehaviourDict: TextsBehaviourDictionary) {
  const sketchObject = layer.sketchObject
  pinConstraints[layer.id] = {"left": sketchObject.hasFixedLeft(),
                             "top": sketchObject.hasFixedTop(),
                             "bottom": sketchObject.hasFixedBottom(),
                             "right": sketchObject.hasFixedRight(),
                             "width": sketchObject.hasFixedWidth(),
                             "height": sketchObject.hasFixedHeight()}
  if (layer.type === dom.Types.Text) {
    const textSketchObject = layer.sketchObject
    textsBehaviourDict[layer.id] = textSketchObject.textBehaviour()
  }
  if ('layers' in layer) {
    (layer.layers as AllSupportedLayers[]).forEach( l => setPinConstraintsAndTextsBehaviourDictFromLayer(l, pinConstraints, textsBehaviourDict))
  }
}

function setExportableImagesFromLayer(mainLayer: AllSupportedLayers, imagesBase64Json: ImagesBase64Dictionary) {
  if (shouldExportLayer(mainLayer)) {
    exportLayer(mainLayer, imagesBase64Json)
  }else if ('layers' in mainLayer) {
    (mainLayer.layers as AllSupportedLayers[]).forEach( l => setExportableImagesFromLayer(l , imagesBase64Json) );
  }else if (mainLayer.type === dom.Types.Image) {
    exportImageLayerImage(mainLayer, imagesBase64Json)
  }
}

function setMasksArray(layer: AllSupportedLayers, masksArray: string[]) {
  if (layer.sketchObject.hasClippingMask()) {
    if (shouldExportLayer(layer) && 'layers' in layer.parent) {
      return true
    }
    masksArray.push(layer.id)
  }
  if ('layers' in layer) {
    (layer.layers as AllSupportedLayers[]).forEach(sublayer => {
      setMasksArray(sublayer, masksArray)
    });
  }
  return false
}

function shouldExportLayer(layer: AllSupportedLayers) {
  if (layer.type === dom.Types.Artboard) {
    return false
  }

  if (layer.type === dom.Types.Shape) {
    return true
  }

  if (layer.type === dom.Types.Group) {
    var shouldExportAsOne = false

    for (var nestedLayer of (layer.layers as AllSupportedLayers[])) {
      if (nestedLayer.sketchObject.hasClippingMask() && shouldExportLayer(nestedLayer)) {
        shouldExportAsOne = true
        break;
      }
    }
    if (shouldExportAsOne) {
      return true;
    }

    shouldExportAsOne = true
    for (var nestedLayer of (layer.layers as AllSupportedLayers[])) {
      if (!shouldExportLayer(nestedLayer)) {
        shouldExportAsOne = false
        break;
      }
    }

    if (shouldExportAsOne) {
      return true;
    }
  }

  if (layer.transform.rotation != 0 || layer.transform.flippedHorizontally || layer.transform.flippedVertically) {
    return true
	}

  if (layer.exportFormats.length != 0) {
    return true
  }

  if ('style' in layer) {
    if (layer.style.blur?.enabled) {
      return true
    }

    for (var fill of (layer.style.fills ?? [])) {
      if (((fill.fillType == "Gradient") || (fill.fillType == "Pattern")) && fill.enabled) {
        return true
      }
    }

    for (var innerShadow of (layer.style.innerShadows ?? [])) {
      if (innerShadow.enabled) {
        return true
      }
    }
  }

  if (layer.type === dom.Types.ShapePath) {
    let shapePath = layer
    if (shapePath.shapeType != "Rectangle") {
      return true
    }
    if (shapePath.points.length != 4) {
      return true
    }
    var previousPoints = []

    for (var point of shapePath.points) {
      for (var previousPoint of previousPoints) {
        if ((previousPoint.point.x == point.point.x) && (previousPoint.point.y == point.point.y)) {
          return true
        }
      }
      if (point.pointType != "Straight") {
        return true
      }
      if (((point.point.x != 0) && (point.point.x != 1)) || ((point.point.y != 0) && (point.point.y != 1))) {
        return true
      }
      previousPoints.push(point)
    }
  }
  return false
}

function exportLayer(layer: dom.Layer, imagesBase64Json: ImagesBase64Dictionary) {
  const buffer = sketch.export(layer, {formats: 'png', scales: '3x', output: false}) as unknown as Buffer
  imagesBase64Json[layer.id] = {"base64": "data:image/png;base64," + buffer.toString('base64'), "name": layer.name}
}

function exportImageLayerImage(layer: dom.Image, imagesBase64Json: ImagesBase64Dictionary) {
  let imageNsData = layer.image.nsdata;
  let base64Code = imageNsData.base64EncodedStringWithOptions(1 << 5).toString();
  base64Code = "data:image/png;base64," + base64Code;
  var sameImageLayerId;
  Object.keys(imagesBase64Json).forEach(function(key) {
      if (imagesBase64Json[key]["base64"] == base64Code) {
        sameImageLayerId = key;
      }
  });
  if (sameImageLayerId == null) {
    imagesBase64Json[layer.id] = {"base64": base64Code, "name": layer.name}
  }else {
    imagesBase64Json[layer.id] = {"layerId": sameImageLayerId}
  }
}
